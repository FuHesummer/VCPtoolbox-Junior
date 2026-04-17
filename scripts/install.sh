#!/usr/bin/env bash
# ============================================================
# VCPtoolbox-Junior Linux 一键安装 / 管理脚本
#
# 用法：
#   # 首次下载
#   curl -fsSL https://raw.githubusercontent.com/FuHesummer/VCPtoolbox-Junior/main/scripts/install.sh -o install.sh
#   chmod +x install.sh
#   ./install.sh
#
#   # 后续管理（菜单内操作）
#
# 项目: https://github.com/FuHesummer/VCPtoolbox-Junior
# 协议: CC BY-NC-SA 4.0
# ============================================================
set -u

SCRIPT_VERSION="1.2.0"
REPO="FuHesummer/VCPtoolbox-Junior"
SCRIPT_URL="https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh"
RELEASE_API="https://api.github.com/repos/${REPO}/releases/latest"
DEFAULT_INSTALL_DIR="${HOME}/vcptoolbox-junior"
PM2_NAME="vcp-junior"
EXE_NAME="VCPtoolbox"
CONFIG_FILE="${HOME}/.vcp-junior-install"
PROXY_FILE="${HOME}/.vcp-junior-proxy"

# GitHub 加速镜像前缀（末尾带斜杠，如 https://ghproxy.net/）
# 国内服务器访问 raw.githubusercontent.com 和 Release 下载可能被墙，需要镜像代理
# 优先级：env GH_PROXY > $PROXY_FILE > 空（直连）
GH_PROXY="${GH_PROXY:-}"

# 推荐镜像（从快到慢，用户可自己改）
RECOMMENDED_PROXIES=(
    "https://ghproxy.net/"
    "https://gh-proxy.com/"
    "https://ghfast.top/"
)

# ------------------------------------------------------------
# 颜色（终端 tty 且未禁用时启用）
# ------------------------------------------------------------
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
    C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'
    C_BLU=$'\033[34m'; C_CYN=$'\033[36m'; C_DIM=$'\033[2m'
    C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
    C_RED=; C_GRN=; C_YLW=; C_BLU=; C_CYN=; C_DIM=; C_BLD=; C_RST=
fi

info()  { printf "%sℹ%s  %s\n" "$C_BLU" "$C_RST" "$*"; }
ok()    { printf "%s✓%s  %s\n" "$C_GRN" "$C_RST" "$*"; }
warn()  { printf "%s⚠%s  %s\n" "$C_YLW" "$C_RST" "$*"; }
err()   { printf "%s✗%s  %s\n" "$C_RED" "$C_RST" "$*" >&2; }
ask()   { printf "%s?%s  %s" "$C_CYN" "$C_RST" "$*"; }

# ------------------------------------------------------------
# 状态变量
# ------------------------------------------------------------
ARCH=""
INSTALL_DIR=""
INSTALLED_VERSION=""
LATEST_VERSION=""
PM2_STATUS=""

detect_arch() {
    case "$(uname -m)" in
        x86_64|amd64)  ARCH="x64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *) err "不支持的架构: $(uname -m)（仅 x86_64 / aarch64）"; exit 1 ;;
    esac
}

load_install_dir() {
    if [ -f "$CONFIG_FILE" ]; then
        INSTALL_DIR="$(cat "$CONFIG_FILE" 2>/dev/null | head -1)"
    fi
    [ -z "$INSTALL_DIR" ] && INSTALL_DIR="$DEFAULT_INSTALL_DIR"
}

save_install_dir() {
    echo "$INSTALL_DIR" > "$CONFIG_FILE"
}

load_proxy() {
    # env 优先；否则读持久化文件
    if [ -z "$GH_PROXY" ] && [ -f "$PROXY_FILE" ]; then
        GH_PROXY="$(cat "$PROXY_FILE" 2>/dev/null | head -1)"
    fi
}

save_proxy() {
    if [ -n "$GH_PROXY" ]; then
        echo "$GH_PROXY" > "$PROXY_FILE"
    else
        rm -f "$PROXY_FILE"
    fi
}

# 包装 github.com / raw.githubusercontent.com URL，走镜像代理
gh_url() {
    local url="$1"
    if [ -n "$GH_PROXY" ]; then
        echo "${GH_PROXY%/}/${url}"
    else
        echo "$url"
    fi
}

refresh_status() {
    # 已装版本
    if [ -f "$INSTALL_DIR/.installed-version" ]; then
        INSTALLED_VERSION="$(cat "$INSTALL_DIR/.installed-version" 2>/dev/null | head -1)"
    else
        INSTALLED_VERSION=""
    fi

    # pm2 状态
    if command -v pm2 >/dev/null 2>&1; then
        local raw
        raw="$(pm2 jlist 2>/dev/null || echo '')"
        if echo "$raw" | grep -q "\"name\":\"${PM2_NAME}\""; then
            PM2_STATUS="$(echo "$raw" | tr ',' '\n' | grep -A1 "\"name\":\"${PM2_NAME}\"" | grep -oE '"status":"[^"]*"' | head -1 | cut -d'"' -f4)"
            [ -z "$PM2_STATUS" ] && PM2_STATUS="unknown"
        else
            PM2_STATUS="未注册"
        fi
    else
        PM2_STATUS="pm2 未装"
    fi
}

fetch_latest_version() {
    LATEST_VERSION="$(curl -fsSL --max-time 10 "$RELEASE_API" 2>/dev/null \
        | grep '"tag_name"' | head -1 | cut -d'"' -f4)"
    [ -z "$LATEST_VERSION" ] && LATEST_VERSION="（拉取失败）"
}

# ------------------------------------------------------------
# 依赖：基础工具 + Node.js + pm2 全自动安装
# ------------------------------------------------------------
NODE_VERSION="v22.16.0"

check_deps() {
    local missing=()
    command -v curl >/dev/null 2>&1 || missing+=("curl")
    command -v tar  >/dev/null 2>&1 || missing+=("tar")
    if [ ${#missing[@]} -gt 0 ]; then
        err "缺少基础依赖: ${missing[*]}"
        echo "  Debian/Ubuntu: sudo apt-get install -y ${missing[*]}"
        echo "  CentOS/RHEL:   sudo yum install -y ${missing[*]}"
        exit 1
    fi
}

ensure_node() {
    if command -v node >/dev/null 2>&1; then
        local ver major
        ver="$(node --version 2>/dev/null)"
        major="$(echo "$ver" | tr -d 'v' | cut -d. -f1)"
        if [ "$major" -ge 18 ] 2>/dev/null; then
            ok "Node.js $ver"
            return 0
        fi
        warn "Node.js $ver 版本太低（需 ≥18），升级到 $NODE_VERSION..."
    else
        info "Node.js 未安装，自动安装 $NODE_VERSION..."
    fi

    local node_arch="$ARCH"
    local dist="node-${NODE_VERSION}-linux-${node_arch}"
    local urls=(
        "https://cdn.npmmirror.com/binaries/node/${NODE_VERSION}/${dist}.tar.xz"
        "https://nodejs.org/dist/${NODE_VERSION}/${dist}.tar.xz"
    )

    local downloaded=0
    for url in "${urls[@]}"; do
        info "下载 Node.js: $url"
        if curl -fL --progress-bar --max-time 180 -o "/tmp/${dist}.tar.xz" "$url" 2>&1; then
            downloaded=1
            break
        fi
        warn "失败，尝试备用源..."
    done

    if [ "$downloaded" -eq 0 ]; then
        err "Node.js 下载失败（所有源均不可达）"
        return 1
    fi

    info "解压到 /usr/local..."
    tar -xJf "/tmp/${dist}.tar.xz" -C /usr/local --strip-components=1 2>&1
    rm -f "/tmp/${dist}.tar.xz"

    # 刷新 PATH（某些环境需要 rehash）
    hash -r 2>/dev/null || true

    if command -v node >/dev/null 2>&1; then
        ok "Node.js $(node --version) 安装完成"
        return 0
    else
        err "Node.js 安装失败（node 不在 PATH 中）"
        return 1
    fi
}

ensure_pm2() {
    if command -v pm2 >/dev/null 2>&1; then
        ok "pm2 $(pm2 --version 2>/dev/null)"
        return 0
    fi

    info "安装 pm2..."
    npm install -g pm2 --registry=https://registry.npmmirror.com 2>&1 | tail -5

    hash -r 2>/dev/null || true

    if command -v pm2 >/dev/null 2>&1; then
        ok "pm2 $(pm2 --version 2>/dev/null) 安装完成"
        return 0
    else
        err "pm2 安装失败"
        return 1
    fi
}

# 多镜像 fallback 下载（支持续传 -C -）
download_with_fallback() {
    local base_url="$1"
    local output="$2"

    local proxies=()
    [ -n "$GH_PROXY" ] && proxies+=("$GH_PROXY")
    for p in "${RECOMMENDED_PROXIES[@]}"; do
        [ "${p}" != "${GH_PROXY}" ] && proxies+=("$p")
    done
    proxies+=("")  # 最后直连

    for proxy in "${proxies[@]}"; do
        local url="${proxy}${base_url}"
        local label="${proxy:-直连 GitHub}"
        info "下载: $label"
        if curl -fL -C - --progress-bar --max-time 900 --connect-timeout 20 -o "$output" "$url" 2>&1; then
            ok "下载完成 ($(du -h "$output" | cut -f1))"
            return 0
        fi
        warn "失败，切换下一个镜像..."
    done

    err "所有镜像均失败"
    return 1
}

# pm2 注册 + 开机自启（全自动）
setup_pm2_service() {
    cd "$INSTALL_DIR" || return 1

    if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
        pm2 restart "$PM2_NAME" 2>&1 | tail -3
    else
        pm2 start "./$EXE_NAME" --name "$PM2_NAME" --interpreter none 2>&1 | tail -3
    fi

    # 开机自启
    if [ "$(id -u)" -eq 0 ]; then
        pm2 startup systemd -u root --hp /root 2>&1 | tail -3
    else
        local startup_cmd
        startup_cmd="$(pm2 startup 2>&1 | grep '^sudo' | head -1)"
        if [ -n "$startup_cmd" ]; then
            info "执行: $startup_cmd"
            eval "$startup_cmd" 2>&1 | tail -3
        fi
    fi

    pm2 save 2>&1 | tail -3
    ok "pm2 服务已注册 + 开机自启已配置"
}

# ------------------------------------------------------------
# 菜单界面
# ------------------------------------------------------------
print_header() {
    clear
    printf "%s╔══════════════════════════════════════════════════╗%s\n" "$C_CYN" "$C_RST"
    printf "%s║%s     %sVCPtoolbox-Junior 管理工具%s     %sv%s%s           %s║%s\n" \
        "$C_CYN" "$C_RST" "$C_BLD" "$C_RST" "$C_DIM" "$SCRIPT_VERSION" "$C_RST" "$C_CYN" "$C_RST"
    printf "%s╠══════════════════════════════════════════════════╣%s\n" "$C_CYN" "$C_RST"

    local dir_show="$INSTALL_DIR"
    [ ${#dir_show} -gt 38 ] && dir_show="...${dir_show: -35}"
    printf "%s║%s  安装路径: %-38s  %s║%s\n" "$C_CYN" "$C_RST" "$dir_show" "$C_CYN" "$C_RST"

    local ver_show="${INSTALLED_VERSION:-未安装}"
    local ver_color="$C_DIM"
    [ -n "$INSTALLED_VERSION" ] && ver_color="$C_GRN"
    printf "%s║%s  当前版本: %s%-38s%s  %s║%s\n" \
        "$C_CYN" "$C_RST" "$ver_color" "$ver_show" "$C_RST" "$C_CYN" "$C_RST"

    local pm2_color="$C_DIM"
    case "$PM2_STATUS" in
        online)  pm2_color="$C_GRN" ;;
        stopped|errored) pm2_color="$C_RED" ;;
    esac
    printf "%s║%s  pm2 状态: %s%-38s%s  %s║%s\n" \
        "$C_CYN" "$C_RST" "$pm2_color" "$PM2_STATUS" "$C_RST" "$C_CYN" "$C_RST"

    local latest_show="${LATEST_VERSION:-（未拉取）}"
    local latest_color="$C_DIM"
    if [ -n "$INSTALLED_VERSION" ] && [ -n "$LATEST_VERSION" ] && [ "$INSTALLED_VERSION" = "$LATEST_VERSION" ]; then
        latest_color="$C_GRN"
        latest_show="$latest_show ✓ 已最新"
    elif [ -n "$INSTALLED_VERSION" ] && [ -n "$LATEST_VERSION" ]; then
        latest_color="$C_YLW"
        latest_show="$latest_show ⬆ 可更新"
    fi
    printf "%s║%s  最新版本: %s%-38s%s  %s║%s\n" \
        "$C_CYN" "$C_RST" "$latest_color" "$latest_show" "$C_RST" "$C_CYN" "$C_RST"

    local proxy_show="${GH_PROXY:-直连}"
    local proxy_color="$C_DIM"
    [ -n "$GH_PROXY" ] && proxy_color="$C_GRN"
    [ ${#proxy_show} -gt 38 ] && proxy_show="${proxy_show:0:35}..."
    printf "%s║%s  镜像代理: %s%-38s%s  %s║%s\n" \
        "$C_CYN" "$C_RST" "$proxy_color" "$proxy_show" "$C_RST" "$C_CYN" "$C_RST"

    printf "%s╠══════════════════════════════════════════════════╣%s\n" "$C_CYN" "$C_RST"
    cat <<EOF
${C_CYN}║${C_RST}   ${C_BLD}1${C_RST}) 安装 / 重新安装到最新 Release
${C_CYN}║${C_RST}   ${C_BLD}2${C_RST}) 更新（保留 config.env + data/）
${C_CYN}║${C_RST}   ${C_BLD}3${C_RST}) 启动服务
${C_CYN}║${C_RST}   ${C_BLD}4${C_RST}) 停止服务
${C_CYN}║${C_RST}   ${C_BLD}5${C_RST}) 重启服务
${C_CYN}║${C_RST}   ${C_BLD}6${C_RST}) 查看状态（pm2 list + info）
${C_CYN}║${C_RST}   ${C_BLD}7${C_RST}) 查看日志（实时跟随，Ctrl+C 退出）
${C_CYN}║${C_RST}   ${C_BLD}8${C_RST}) 编辑 config.env
${C_CYN}║${C_RST}   ${C_BLD}9${C_RST}) 配置开机自启（pm2 startup + save）
${C_CYN}║${C_RST}  ${C_BLD}10${C_RST}) 更新本脚本（从 GitHub raw 拉新版）
${C_CYN}║${C_RST}  ${C_BLD}11${C_RST}) 卸载（删目录 + pm2 delete）
${C_CYN}║${C_RST}  ${C_BLD}12${C_RST}) 配置 GitHub 加速镜像（国内服务器必备）
${C_CYN}║${C_RST}   ${C_BLD}r${C_RST}) 刷新状态
${C_CYN}║${C_RST}   ${C_BLD}q${C_RST}) 退出
${C_CYN}╚══════════════════════════════════════════════════╝${C_RST}
EOF
}

pause() {
    echo ""
    read -r -p "按回车返回菜单..." _
}

# ------------------------------------------------------------
# 操作：安装
# ------------------------------------------------------------
action_install() {
    echo ""
    info "准备安装 VCPtoolbox-Junior"

    # --- 交互：确认安装路径 ---
    if [ "${AUTO_MODE:-0}" -eq 0 ]; then
        ask "安装路径 [${INSTALL_DIR}]: "
        read -r input
        if [ -n "$input" ]; then
            input="${input/#\~/$HOME}"
            INSTALL_DIR="$(cd "$(dirname "$input")" 2>/dev/null && pwd)/$(basename "$input")" 2>/dev/null || INSTALL_DIR="$input"
        fi
    fi
    save_install_dir

    if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
        warn "目录非空: $INSTALL_DIR"
        if [ "${AUTO_MODE:-0}" -eq 0 ]; then
            ask "继续覆盖安装？已有 config.env 会被保留 [y/N]: "
            read -r confirm
            [ "$confirm" != "y" ] && [ "$confirm" != "Y" ] && return
        else
            info "自动模式：覆盖安装（保留 config.env + data/）"
        fi
    fi

    # --- Step 1: 确保 Node + pm2 ---
    info "=== Step 1/4: 检查运行环境 ==="
    ensure_node || return 1
    ensure_pm2 || return 1

    # --- Step 2: 下载 Release ---
    info "=== Step 2/4: 下载最新 Release ==="
    mkdir -p "$INSTALL_DIR" || { err "无法创建目录"; return 1; }
    cd "$INSTALL_DIR" || return 1

    [ -z "$LATEST_VERSION" ] || [[ "$LATEST_VERSION" == *失败* ]] && fetch_latest_version
    if [[ "$LATEST_VERSION" == *失败* ]]; then
        err "无法获取最新版本，请检查网络"
        return 1
    fi

    local asset="vcp-junior-linux-${ARCH}.tar.gz"
    local base_url="https://github.com/${REPO}/releases/download/${LATEST_VERSION}/${asset}"

    # 备份可能已存在的 config.env 和 data/
    local backup_cfg="" backup_data=""
    [ -f config.env ] && { backup_cfg="$(mktemp)"; cp config.env "$backup_cfg"; }
    [ -d data ]       && { backup_data="$(mktemp -d)"; cp -r data "$backup_data/"; }

    if ! download_with_fallback "$base_url" "$asset"; then
        err "所有镜像下载均失败"
        return 1
    fi

    # --- Step 3: 解压 + 恢复数据 ---
    info "=== Step 3/4: 解压安装 ==="
    tar -xzf "$asset" || { err "解压失败"; return 1; }
    rm -f "$asset"

    local extracted="vcp-junior-linux-${ARCH}"
    if [ -d "$extracted" ]; then
        (shopt -s dotglob; cp -r "$extracted"/* . 2>/dev/null || true)
        rm -rf "$extracted"
    fi

    # 恢复用户数据
    if [ -n "$backup_cfg" ] && [ -f "$backup_cfg" ]; then
        cp "$backup_cfg" config.env; rm -f "$backup_cfg"
        info "已保留原 config.env"
    elif [ -f config.env.example ] && [ ! -f config.env ]; then
        cp config.env.example config.env
        warn "已复制 config.env.example → config.env"
        warn "**务必**编辑 config.env 填入 API_Key / Key / AdminPassword 等"
    fi

    if [ -n "$backup_data" ] && [ -d "$backup_data/data" ]; then
        rm -rf data; cp -r "$backup_data/data" .; rm -rf "$backup_data"
        info "已保留原 data/ 目录"
    fi

    chmod +x "$EXE_NAME" 2>/dev/null || true
    echo "$LATEST_VERSION" > .installed-version
    INSTALLED_VERSION="$LATEST_VERSION"

    # --- Step 4: 注册 pm2 + 开机自启 ---
    info "=== Step 4/4: 注册 pm2 服务 + 开机自启 ==="
    setup_pm2_service

    echo ""
    ok "========================================="
    ok "  安装完成！$LATEST_VERSION"
    ok "  安装路径: $INSTALL_DIR"
    ok "  服务状态: pm2 list"
    ok "  管理面板: http://<IP>:$(( $(grep -oP '(?<=^PORT=)\d+' "$INSTALL_DIR/config.env" 2>/dev/null || echo 6005) + 1 ))/AdminPanel/"
    ok "========================================="
    echo ""
    warn "首次安装记得编辑 config.env（菜单 8）再重启服务（菜单 5）"
}

# ------------------------------------------------------------
# 操作：更新（保留 config.env + data/）
# ------------------------------------------------------------
action_update() {
    [ -z "$INSTALLED_VERSION" ] && { err "尚未安装，先执行菜单 1"; return; }

    fetch_latest_version
    if [[ "$LATEST_VERSION" == *失败* ]]; then
        err "无法获取最新版本"
        return
    fi

    if [ "$INSTALLED_VERSION" = "$LATEST_VERSION" ]; then
        ok "已是最新 ($LATEST_VERSION)"
        return
    fi

    info "当前: $INSTALLED_VERSION  →  最新: $LATEST_VERSION"
    ask "确认更新？[y/N]: "
    read -r confirm
    [ "$confirm" != "y" ] && [ "$confirm" != "Y" ] && return

    local was_online=0
    if [ "$PM2_STATUS" = "online" ]; then
        was_online=1
        info "停止服务..."
        pm2 stop "$PM2_NAME" >/dev/null 2>&1 || true
    fi

    cd "$INSTALL_DIR" || return 1
    local asset="vcp-junior-linux-${ARCH}.tar.gz"
    local url
    url="$(gh_url "https://github.com/${REPO}/releases/download/${LATEST_VERSION}/${asset}")"

    info "下载..."
    [ -n "$GH_PROXY" ] && info "走镜像: $GH_PROXY"
    if ! curl -fL --progress-bar -o ".update.tar.gz" "$url"; then
        err "下载失败"
        [ -z "$GH_PROXY" ] && warn "国内服务器菜单 12 配置镜像代理后重试"
        return 1
    fi

    info "解压到临时目录..."
    rm -rf .tmp-update
    mkdir .tmp-update
    tar -xzf .update.tar.gz -C .tmp-update

    local extracted=".tmp-update/vcp-junior-linux-${ARCH}"
    if [ ! -d "$extracted" ]; then
        err "压缩包结构异常"
        rm -rf .tmp-update .update.tar.gz
        return 1
    fi

    info "替换文件（保留用户数据）..."
    # 分三类处理：
    #   SKIP    — 完全不动（config.env / data / 日志 / 缓存 / 用户偏好）
    #   MERGE   — cp -r 合并（Agent / knowledge / thinking / TVStxt / image）
    #             新文件会覆盖同名旧文件，但不删除旧文件 → 用户日记/知识库安全
    #   REPLACE — rm -rf 后 cp -r 替换（代码模块 / 依赖 / 可执行文件等）
    (shopt -s dotglob
     for item in "$extracted"/*; do
        local name
        name="$(basename "$item")"
        case "$name" in
            # === SKIP: 完全跳过 ===
            config.env|data|DebugLog|.file_cache|agent_map.json|plugin-ui-prefs.json)
                continue ;;
            # === MERGE: 合并（保留用户数据，更新模板文件）===
            Agent|knowledge|thinking|TVStxt|image)
                cp -r "$item"/* "./$name/" 2>/dev/null || cp -r "$item" "./$name"
                ;;
            # === REPLACE: 删旧换新 ===
            *)
                rm -rf "./$name"
                cp -r "$item" "./$name"
                ;;
        esac
     done)

    # 如果本地没有 config.env 但新包有 example，补个 example（不覆盖 config.env）
    if [ -f "$extracted/config.env.example" ]; then
        cp "$extracted/config.env.example" ./config.env.example
    fi

    rm -rf .tmp-update .update.tar.gz
    chmod +x "$EXE_NAME" 2>/dev/null || true
    echo "$LATEST_VERSION" > .installed-version
    INSTALLED_VERSION="$LATEST_VERSION"

    if [ "$was_online" -eq 1 ]; then
        info "重启服务..."
        pm2 restart "$PM2_NAME" >/dev/null 2>&1 || pm2 start "./$EXE_NAME" --name "$PM2_NAME" --interpreter none
    fi

    ok "更新完成 → $LATEST_VERSION"
}

# ------------------------------------------------------------
# 操作：启动/停止/重启
# ------------------------------------------------------------
action_start() {
    [ -z "$INSTALLED_VERSION" ] && { err "尚未安装"; return; }
    ensure_pm2 || return
    setup_pm2_service
}

action_stop() {
    command -v pm2 >/dev/null 2>&1 || { err "pm2 未装"; return; }
    pm2 stop "$PM2_NAME" 2>&1 | tail -3
    ok "已停止"
}

action_restart() {
    command -v pm2 >/dev/null 2>&1 || { err "pm2 未装"; return; }
    pm2 restart "$PM2_NAME" 2>&1 | tail -3
    ok "已重启"
}

action_status() {
    command -v pm2 >/dev/null 2>&1 || { err "pm2 未装"; return; }
    pm2 list
    echo ""
    pm2 info "$PM2_NAME" 2>/dev/null || warn "$PM2_NAME 未注册"
}

action_logs() {
    command -v pm2 >/dev/null 2>&1 || { err "pm2 未装"; return; }
    info "实时日志（Ctrl+C 退出）"
    echo ""
    pm2 logs "$PM2_NAME"
}

# ------------------------------------------------------------
# 操作：编辑 config.env
# ------------------------------------------------------------
action_edit_config() {
    [ -z "$INSTALLED_VERSION" ] && { err "尚未安装"; return; }
    local cfg="$INSTALL_DIR/config.env"
    if [ ! -f "$cfg" ]; then
        if [ -f "$INSTALL_DIR/config.env.example" ]; then
            cp "$INSTALL_DIR/config.env.example" "$cfg"
            info "已从 example 创建 config.env"
        else
            err "config.env 不存在"
            return
        fi
    fi

    local editor="${EDITOR:-${VISUAL:-}}"
    if [ -z "$editor" ]; then
        for e in nano vim vi; do
            if command -v "$e" >/dev/null 2>&1; then editor="$e"; break; fi
        done
    fi
    [ -z "$editor" ] && { err "未找到可用编辑器（nano/vim/vi）"; return; }

    "$editor" "$cfg"
    warn "修改了 config.env 后记得重启服务（菜单 5）"
}

# ------------------------------------------------------------
# 操作：开机自启
# ------------------------------------------------------------
action_startup() {
    ensure_pm2 || return
    echo ""
    info "配置开机自启（pm2 startup + save）"
    setup_pm2_service
}

# ------------------------------------------------------------
# 操作：脚本自更新
# ------------------------------------------------------------
action_self_update() {
    local url
    url="$(gh_url "$SCRIPT_URL")"
    info "从 $url 拉取..."
    local tmp
    tmp="$(mktemp)"
    if ! curl -fsSL --max-time 15 "$url" -o "$tmp"; then
        err "拉取失败"
        [ -z "$GH_PROXY" ] && warn "国内服务器菜单 12 配置镜像代理后重试"
        rm -f "$tmp"
        return 1
    fi
    if [ ! -s "$tmp" ]; then
        err "拉取内容为空"
        rm -f "$tmp"
        return 1
    fi

    local remote_ver
    remote_ver="$(grep -E '^SCRIPT_VERSION=' "$tmp" | head -1 | cut -d'"' -f2)"
    info "当前版本: $SCRIPT_VERSION"
    info "远端版本: ${remote_ver:-未知}"

    if [ -n "$remote_ver" ] && [ "$remote_ver" = "$SCRIPT_VERSION" ]; then
        ok "脚本已是最新，无需更新"
        rm -f "$tmp"
        return
    fi

    ask "替换当前脚本 $0？[y/N]: "
    read -r confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        rm -f "$tmp"
        return
    fi

    chmod +x "$tmp"
    # 写入自己
    if cp "$tmp" "$0"; then
        rm -f "$tmp"
        ok "脚本已更新到 ${remote_ver:-新版}，请重新运行: bash $0"
        exit 0
    else
        err "无法替换脚本（权限不足？）"
        echo "  手动替换: sudo cp $tmp $0"
        return 1
    fi
}

# ------------------------------------------------------------
# 操作：配置 GitHub 加速镜像
# ------------------------------------------------------------
action_proxy() {
    echo ""
    info "当前镜像: ${GH_PROXY:-（未设置，直连 GitHub）}"
    echo ""
    echo "国内服务器直连 raw.githubusercontent.com / release-assets 可能被墙，"
    echo "可以选一个 GitHub 加速镜像。推荐："
    echo ""
    local i=1
    for p in "${RECOMMENDED_PROXIES[@]}"; do
        echo "  $i) $p"
        i=$((i + 1))
    done
    echo "  c) 自定义镜像 URL（以 / 结尾）"
    echo "  n) 清除镜像（改为直连）"
    echo "  t) 测试当前镜像连通性"
    echo "  x) 返回（不修改）"
    echo ""
    ask "选择 [1-${#RECOMMENDED_PROXIES[@]}/c/n/t/x]: "
    read -r pchoice

    case "$pchoice" in
        1|2|3)
            local idx=$((pchoice - 1))
            GH_PROXY="${RECOMMENDED_PROXIES[$idx]}"
            save_proxy
            ok "已设置镜像: $GH_PROXY"
            ;;
        c|C)
            ask "输入镜像 URL（如 https://xxx.com/）: "
            read -r custom
            if [ -n "$custom" ]; then
                # 自动补斜杠
                [ "${custom: -1}" != "/" ] && custom="${custom}/"
                GH_PROXY="$custom"
                save_proxy
                ok "已设置镜像: $GH_PROXY"
            fi
            ;;
        n|N)
            GH_PROXY=""
            save_proxy
            ok "已清除镜像，改为直连"
            ;;
        t|T)
            local test_url="https://raw.githubusercontent.com/${REPO}/main/README.md"
            [ -n "$GH_PROXY" ] && test_url="${GH_PROXY%/}/${test_url}"
            info "测试 $test_url"
            local code
            code=$(timeout 15 curl -sSo /dev/null -w "%{http_code}" "$test_url" 2>&1)
            if [ "$code" = "200" ]; then
                ok "镜像正常"
            else
                err "镜像异常 (HTTP $code)"
            fi
            ;;
        *)
            info "已取消"
            ;;
    esac
}

# ------------------------------------------------------------
# 操作：卸载
# ------------------------------------------------------------
action_uninstall() {
    [ -z "$INSTALL_DIR" ] && { err "没找到安装目录"; return; }

    warn "即将卸载"
    echo "  目录: $INSTALL_DIR"
    echo "  进程: $PM2_NAME"
    echo ""
    warn "所有数据（config.env / data/ / DebugLog/）都会被删除，不可恢复"
    ask "输入 yes 确认: "
    read -r confirm
    if [ "$confirm" != "yes" ]; then
        info "已取消"
        return
    fi

    if command -v pm2 >/dev/null 2>&1; then
        pm2 delete "$PM2_NAME" 2>/dev/null || true
        pm2 save 2>/dev/null || true
    fi
    rm -rf "$INSTALL_DIR"
    rm -f "$CONFIG_FILE"

    ok "已卸载"
    INSTALLED_VERSION=""
    PM2_STATUS="未注册"
}

# ------------------------------------------------------------
# 主循环
# ------------------------------------------------------------
# ------------------------------------------------------------
# CLI 直入模式（非交互一键安装）
# Usage: bash install.sh install   → 全自动安装
#        bash install.sh           → 交互式菜单
# ------------------------------------------------------------
AUTO_MODE=0

cli_install() {
    AUTO_MODE=1
    check_deps
    detect_arch
    load_install_dir
    load_proxy
    fetch_latest_version
    action_install
    exit $?
}

# 参数分发
case "${1:-}" in
    install)  cli_install ;;
    "")       ;;  # 进交互菜单
    *)        echo "用法: bash $0 [install]"; exit 1 ;;
esac

main() {
    check_deps
    detect_arch
    load_install_dir
    load_proxy
    refresh_status
    fetch_latest_version

    while true; do
        print_header
        ask "选择 [1-12/r/q]: "
        read -r choice

        case "$choice" in
            1)  action_install ;;
            2)  action_update ;;
            3)  action_start ;;
            4)  action_stop ;;
            5)  action_restart ;;
            6)  action_status ;;
            7)  action_logs ;;
            8)  action_edit_config ;;
            9)  action_startup ;;
            10) action_self_update ;;
            11) action_uninstall ;;
            12) action_proxy ;;
            r|R) fetch_latest_version ;;
            q|Q) echo ""; ok "再见 👋"; exit 0 ;;
            "") ;;
            *) warn "无效选择: $choice" ;;
        esac

        refresh_status
        pause
    done
}

main "$@"
