import json
import os
import queue
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, X, StringVar, Tk, filedialog, messagebox, ttk
import tkinter as tk


APP_NAME = "Two-Day Weekend Marketplace Server Monitor"
DEFAULT_CONFIG = {
    "server_ipv6": "2402:4e00:c013:8600:5602:3dc2:a2d0:0",
    "scheme": "http",
    "base_path": "/shc-20260520-a1faaf/weekend-marketplace/",
    "admin_token": "",
    "history_minutes": 360,
    "poll_interval_seconds": 8,
    "request_timeout_seconds": 4,
    "signal_probe_room_id": "monitor-probe",
    "signal_probe_peer_id": "server-monitor",
}

MONITOR_HEADERS = {
    "User-Agent": "ShuangxiuServerMonitor/1.0",
    "X-Monitor-Probe": "server-monitor",
}


def monitor_headers(config: dict) -> dict:
    headers = dict(MONITOR_HEADERS)
    token = str(config.get("admin_token", "")).strip()
    if token:
        headers["X-Admin-Token"] = token
    return headers


def app_dir() -> Path:
    if getattr(__import__("sys"), "frozen", False):
        return Path(__import__("sys").executable).resolve().parent
    return Path(__file__).resolve().parent


CONFIG_PATH = app_dir() / "config.json"


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, ensure_ascii=False, indent=2), encoding="utf-8")
        return dict(DEFAULT_CONFIG)
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = {}
    config = dict(DEFAULT_CONFIG)
    config.update({key: value for key, value in data.items() if value not in (None, "")})
    return config


def save_config(config: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_base_path(value: str) -> str:
    value = value.strip() or DEFAULT_CONFIG["base_path"]
    if not value.startswith("/"):
        value = "/" + value
    if not value.endswith("/"):
        value += "/"
    return value


def build_urls(config: dict) -> dict:
    host = f"[{config['server_ipv6'].strip()}]"
    root = f"{config['scheme'].strip()}://{host}{normalize_base_path(config['base_path'])}"
    api = urllib.parse.urljoin(root, "api/")
    return {
        "root": root,
        "health": urllib.parse.urljoin(root, "health"),
        "marketplace": urllib.parse.urljoin(api, "marketplace"),
        "download_meta": urllib.parse.urljoin(api, "download"),
        "download_page": urllib.parse.urljoin(root, "download"),
        "apk": urllib.parse.urljoin(root, "download/two-day-weekend-marketplace.apk"),
        "live_sessions": urllib.parse.urljoin(api, "live/sessions"),
        "metrics_history": urllib.parse.urljoin(api, "metrics/history"),
        "signal_probe": urllib.parse.urljoin(
            api,
            f"signaling/rooms/{urllib.parse.quote(config['signal_probe_room_id'])}/messages",
        ),
    }


@dataclass
class EndpointStat:
    name: str
    url: str
    ok_count: int = 0
    fail_count: int = 0
    total_ms: float = 0.0
    last_status: str = "未检查"
    last_ms: float = 0.0
    last_error: str = ""

    @property
    def total_count(self) -> int:
        return self.ok_count + self.fail_count

    @property
    def success_rate(self) -> float:
        return self.ok_count / self.total_count if self.total_count else 0.0

    @property
    def avg_ms(self) -> float:
        return self.total_ms / self.total_count if self.total_count else 0.0


@dataclass
class MonitorState:
    endpoints: dict[str, EndpointStat] = field(default_factory=dict)
    started_at: float = field(default_factory=time.time)
    observed_download_probes: int = 0
    observed_signal_polls: int = 0
    observed_marketplace_loads: int = 0
    product_count: int = 0
    store_count: int = 0
    live_room_count: int = 0
    ledger_height: int = 0
    apk_file_size: int = 0
    apk_available: bool = False
    history_buckets: list[dict] = field(default_factory=list)
    history_totals: dict = field(default_factory=dict)
    history_peak: dict = field(default_factory=dict)
    metrics_available: bool = False


class ServerMonitorApp:
    def __init__(self, root: Tk):
        self.root = root
        self.root.title(APP_NAME)
        self.root.geometry("1080x720")
        self.root.minsize(920, 620)
        self.config = load_config()
        self._request_config = dict(self.config)
        self.state = MonitorState()
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.stop_event = threading.Event()
        self.worker: threading.Thread | None = None

        self.server_ipv6 = StringVar(value=self.config["server_ipv6"])
        self.base_path = StringVar(value=self.config["base_path"])
        self.interval = StringVar(value=str(self.config["poll_interval_seconds"]))
        self.admin_token = StringVar(value=self.config.get("admin_token", ""))
        self.history_minutes = StringVar(value=str(self.config.get("history_minutes", 360)))
        self.status = StringVar(value="未启动")
        self.summary = StringVar(value="等待开始监测")
        self.url_text = StringVar(value="")

        self.endpoint_rows: dict[str, str] = {}
        self.metric_vars = {
            "connect": StringVar(value="未检查"),
            "downloads": StringVar(value="0"),
            "visitors": StringVar(value="0"),
            "pressure": StringVar(value="0 monitor req/min"),
            "live": StringVar(value="0"),
            "ledger": StringVar(value="0"),
            "apk": StringVar(value="未知"),
            "peak": StringVar(value="未拉取"),
        }

        self.build_ui()
        self.refresh_urls()
        self.root.after(250, self.drain_events)
        self.root.after(900, lambda: self.metrics_history_async() if self.admin_token.get().strip() else None)

    def build_ui(self) -> None:
        outer = ttk.Frame(self.root, padding=12)
        outer.pack(fill=BOTH, expand=True)

        header = ttk.Frame(outer)
        header.pack(fill=X)
        ttk.Label(header, text=APP_NAME, font=("Microsoft YaHei UI", 18, "bold")).pack(side=LEFT)
        ttk.Label(header, textvariable=self.status, foreground="#2f8f83").pack(side=RIGHT)

        config_frame = ttk.LabelFrame(outer, text="服务器地址")
        config_frame.pack(fill=X, pady=(10, 8))
        ttk.Label(config_frame, text="IPv6").grid(row=0, column=0, padx=8, pady=8, sticky="w")
        ttk.Entry(config_frame, textvariable=self.server_ipv6, width=44).grid(row=0, column=1, padx=8, pady=8, sticky="we")
        ttk.Label(config_frame, text="商城路径").grid(row=0, column=2, padx=8, pady=8, sticky="w")
        ttk.Entry(config_frame, textvariable=self.base_path, width=42).grid(row=0, column=3, padx=8, pady=8, sticky="we")
        ttk.Label(config_frame, text="刷新秒数").grid(row=0, column=4, padx=8, pady=8, sticky="w")
        ttk.Entry(config_frame, textvariable=self.interval, width=8).grid(row=0, column=5, padx=8, pady=8, sticky="we")
        ttk.Label(config_frame, text="历史分钟").grid(row=1, column=0, padx=8, pady=8, sticky="w")
        ttk.Entry(config_frame, textvariable=self.history_minutes, width=12).grid(row=1, column=1, padx=8, pady=8, sticky="w")
        ttk.Label(config_frame, text="Admin Token").grid(row=1, column=2, padx=8, pady=8, sticky="w")
        ttk.Entry(config_frame, textvariable=self.admin_token, show="*", width=42).grid(row=1, column=3, columnspan=3, padx=8, pady=8, sticky="we")
        config_frame.columnconfigure(1, weight=1)
        config_frame.columnconfigure(3, weight=1)

        actions = ttk.Frame(outer)
        actions.pack(fill=X, pady=(0, 8))
        ttk.Button(actions, text="保存配置", command=self.save_current_config).pack(side=LEFT, padx=(0, 8))
        ttk.Button(actions, text="开始监测", command=self.start).pack(side=LEFT, padx=(0, 8))
        ttk.Button(actions, text="停止", command=self.stop).pack(side=LEFT, padx=(0, 8))
        ttk.Button(actions, text="立即检查一次", command=self.check_once_async).pack(side=LEFT, padx=(0, 8))
        ttk.Button(actions, text="拉取历史波形", command=self.metrics_history_async).pack(side=LEFT, padx=(0, 8))
        ttk.Button(actions, text="信令压力探测", command=self.signal_probe_async).pack(side=LEFT, padx=(0, 8))
        ttk.Button(actions, text="打开配置位置", command=self.open_config_location).pack(side=RIGHT)

        url_frame = ttk.LabelFrame(outer, text="当前监测根地址")
        url_frame.pack(fill=X, pady=(0, 8))
        ttk.Label(url_frame, textvariable=self.url_text).pack(fill=X, padx=8, pady=8)

        metric_frame = ttk.Frame(outer)
        metric_frame.pack(fill=X, pady=(0, 8))
        metrics = [
            ("连通状态", "connect"),
            ("本机商城探测", "visitors"),
            ("本机下载探测", "downloads"),
            ("本机探测压力", "pressure"),
            ("直播房间", "live"),
            ("账本高度", "ledger"),
            ("APK", "apk"),
            ("历史峰值", "peak"),
        ]
        for index, (label, key) in enumerate(metrics):
            card = ttk.LabelFrame(metric_frame, text=label)
            card.grid(row=0, column=index, padx=4, sticky="nsew")
            ttk.Label(card, textvariable=self.metric_vars[key], font=("Microsoft YaHei UI", 13, "bold")).pack(padx=10, pady=10)
            metric_frame.columnconfigure(index, weight=1)

        ttk.Label(
            outer,
            text="提示：这些访问、下载、压力数字是本工具在本机发出的监控探测，不代表真实用户访问量。真实人数/下载次数需要读取服务器 access log 或专门 metrics 接口。",
            foreground="#8a5a2b",
            wraplength=980,
        ).pack(fill=X, pady=(0, 8))

        body = ttk.PanedWindow(outer, orient="horizontal")
        body.pack(fill=BOTH, expand=True)

        left = ttk.Frame(body)
        body.add(left, weight=3)
        right = ttk.Frame(body)
        body.add(right, weight=2)

        self.endpoint_tree = ttk.Treeview(
            left,
            columns=("status", "last", "avg", "ok", "fail"),
            show="tree headings",
            height=14,
        )
        self.endpoint_tree.heading("#0", text="接口")
        self.endpoint_tree.heading("status", text="状态")
        self.endpoint_tree.heading("last", text="本次耗时")
        self.endpoint_tree.heading("avg", text="平均耗时")
        self.endpoint_tree.heading("ok", text="成功")
        self.endpoint_tree.heading("fail", text="失败")
        self.endpoint_tree.column("#0", width=180)
        self.endpoint_tree.column("status", width=100)
        self.endpoint_tree.column("last", width=90, anchor="e")
        self.endpoint_tree.column("avg", width=90, anchor="e")
        self.endpoint_tree.column("ok", width=70, anchor="e")
        self.endpoint_tree.column("fail", width=70, anchor="e")
        self.endpoint_tree.pack(fill=BOTH, expand=True)

        chart_frame = ttk.LabelFrame(left, text="历史压力波形（请求/下载/流量）")
        chart_frame.pack(fill=BOTH, expand=True, pady=(8, 0))
        self.chart_canvas = tk.Canvas(chart_frame, height=180, background="#f8fbf9", highlightthickness=0)
        self.chart_canvas.pack(fill=BOTH, expand=True, padx=8, pady=8)

        ttk.Label(right, text="事件日志", font=("Microsoft YaHei UI", 11, "bold")).pack(anchor="w")
        self.log_box = __import__("tkinter").Text(right, height=18, wrap="word")
        self.log_box.pack(fill=BOTH, expand=True, pady=(6, 0))
        ttk.Label(right, textvariable=self.summary, foreground="#557069").pack(fill=X, pady=(8, 0))

    def current_config(self) -> dict:
        config = dict(self.config)
        config["server_ipv6"] = self.server_ipv6.get().strip()
        config["base_path"] = normalize_base_path(self.base_path.get())
        config["admin_token"] = self.admin_token.get().strip()
        try:
            config["poll_interval_seconds"] = max(2, int(float(self.interval.get())))
        except ValueError:
            config["poll_interval_seconds"] = DEFAULT_CONFIG["poll_interval_seconds"]
        try:
            config["history_minutes"] = max(5, min(60 * 24 * 14, int(float(self.history_minutes.get()))))
        except ValueError:
            config["history_minutes"] = DEFAULT_CONFIG["history_minutes"]
        return config

    def save_current_config(self) -> None:
        self.config = self.current_config()
        self._request_config = dict(self.config)
        save_config(self.config)
        self.refresh_urls()
        self.log(f"配置已保存：{CONFIG_PATH}")

    def refresh_urls(self) -> None:
        urls = build_urls(self.current_config())
        self.url_text.set(urls["root"])
        for name, url in urls.items():
            if name not in self.state.endpoints:
                self.state.endpoints[name] = EndpointStat(name, url)
                self.endpoint_rows[name] = self.endpoint_tree.insert("", END, text=name, values=("未检查", "-", "-", 0, 0))
            self.state.endpoints[name].url = url
        self.render()

    def start(self) -> None:
        if self.worker and self.worker.is_alive():
            return
        self.save_current_config()
        self.stop_event.clear()
        self.worker = threading.Thread(target=self.monitor_loop, daemon=True)
        self.worker.start()
        self.status.set("监测中")
        self.log("开始实时监测")

    def stop(self) -> None:
        self.stop_event.set()
        self.status.set("已停止")
        self.log("已请求停止监测")

    def check_once_async(self) -> None:
        threading.Thread(target=self.check_once, daemon=True).start()

    def signal_probe_async(self) -> None:
        threading.Thread(target=self.run_signal_probe, daemon=True).start()

    def metrics_history_async(self) -> None:
        threading.Thread(target=self.fetch_metrics_history, daemon=True).start()

    def monitor_loop(self) -> None:
        while not self.stop_event.is_set():
            self.check_once()
            interval = self.current_config()["poll_interval_seconds"]
            self.stop_event.wait(interval)

    def check_once(self) -> None:
        config = self.current_config()
        self._request_config = dict(config)
        urls = build_urls(config)
        endpoint_order = ["root", "health", "marketplace", "download_meta", "download_page", "live_sessions"]
        for name in endpoint_order:
            self.fetch_endpoint(name, urls[name], config["request_timeout_seconds"])
        self.fetch_metrics_history(silent=True)
        self.events.put(("render", None))

    def fetch_metrics_history(self, silent: bool = False) -> None:
        config = self.current_config()
        token = config.get("admin_token", "")
        if not token:
            self.state.metrics_available = False
            if not silent:
                self.events.put(("log", "未配置 Admin Token，无法拉取服务端真实历史 metrics。"))
            self.events.put(("render", None))
            return
        urls = build_urls(config)
        params = urllib.parse.urlencode({"minutes": config["history_minutes"]})
        url = f"{urls['metrics_history']}?{params}"
        try:
            request = urllib.request.Request(
                url,
                headers={
                    **monitor_headers(config),
                    "X-Admin-Token": token,
                },
            )
            with urllib.request.urlopen(request, timeout=config["request_timeout_seconds"]) as response:
                data = json.loads(response.read(2 * 1024 * 1024).decode("utf-8", errors="replace"))
            self.state.history_buckets = data.get("buckets") or []
            self.state.history_totals = data.get("totals") or {}
            self.state.history_peak = data.get("peak") or {}
            self.state.metrics_available = True
            if not silent:
                self.events.put(("log", f"已拉取 {len(self.state.history_buckets)} 个分钟桶历史 metrics。"))
        except Exception as error:
            self.state.metrics_available = False
            if not silent:
                self.events.put(("log", f"历史 metrics 拉取失败：{error}"))
        self.events.put(("render", None))

    def run_signal_probe(self) -> None:
        config = self.current_config()
        urls = build_urls(config)
        endpoint = self.state.endpoints.get("signal_probe") or EndpointStat("signal_probe", urls["signal_probe"])
        self.state.endpoints["signal_probe"] = endpoint
        if "signal_probe" not in self.endpoint_rows:
            self.events.put(("row", "signal_probe"))
        peer = urllib.parse.quote(config["signal_probe_peer_id"])
        url = f"{urls['signal_probe']}?peer={peer}"
        self.fetch_endpoint("signal_probe", url, config["request_timeout_seconds"])
        self.state.observed_signal_polls += 1
        self.events.put(("log", "信令压力探测完成：拉取一次消息队列"))
        self.events.put(("render", None))

    def fetch_endpoint(self, name: str, url: str, timeout: int) -> None:
        endpoint = self.state.endpoints.get(name) or EndpointStat(name, url)
        self.state.endpoints[name] = endpoint
        endpoint.url = url
        started = time.perf_counter()
        try:
            request = urllib.request.Request(
                url,
                headers=monitor_headers(getattr(self, "_request_config", DEFAULT_CONFIG)),
            )
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read(1024 * 1024)
                elapsed = (time.perf_counter() - started) * 1000
                endpoint.ok_count += 1
                endpoint.total_ms += elapsed
                endpoint.last_ms = elapsed
                endpoint.last_status = f"HTTP {response.status}"
                endpoint.last_error = ""
                self.observe_payload(name, response, body)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            elapsed = (time.perf_counter() - started) * 1000
            endpoint.fail_count += 1
            endpoint.total_ms += elapsed
            endpoint.last_ms = elapsed
            endpoint.last_status = "失败"
            endpoint.last_error = str(error)
            self.events.put(("log", f"{name} 失败：{endpoint.last_error}"))

    def observe_payload(self, name: str, response, body: bytes) -> None:
        if name == "marketplace":
            self.state.observed_marketplace_loads += 1
        if name in ("download_meta", "download_page", "apk"):
            self.state.observed_download_probes += 1
        content_type = response.headers.get("Content-Type", "")
        if "application/json" not in content_type:
            return
        try:
            data = json.loads(body.decode("utf-8", errors="replace"))
        except json.JSONDecodeError:
            return
        if name == "marketplace":
            self.state.product_count = len(data.get("products") or [])
            self.state.store_count = len(data.get("stores") or [])
            events = data.get("ledgerEvents") or []
            heights = [int(event.get("blockHeight") or 0) for event in events if isinstance(event, dict)]
            self.state.ledger_height = max(heights or [self.state.ledger_height])
        elif name == "download_meta":
            self.state.apk_available = bool(data.get("available"))
            self.state.apk_file_size = int(data.get("fileSizeBytes") or 0)
        elif name == "live_sessions":
            rooms = data.get("rooms")
            sessions = data.get("sessions")
            self.state.live_room_count = len(rooms or sessions or [])
        elif name == "health":
            ledger = data.get("ledger") if isinstance(data, dict) else None
            if isinstance(ledger, dict):
                self.state.ledger_height = max(self.state.ledger_height, int(ledger.get("height") or 0))

    def drain_events(self) -> None:
        try:
            while True:
                event, payload = self.events.get_nowait()
                if event == "log":
                    self.log(str(payload))
                elif event == "row":
                    name = str(payload)
                    if name not in self.endpoint_rows:
                        self.endpoint_rows[name] = self.endpoint_tree.insert("", END, text=name, values=("未检查", "-", "-", 0, 0))
                elif event == "render":
                    self.render()
        except queue.Empty:
            pass
        self.root.after(250, self.drain_events)

    def render(self) -> None:
        total_requests = 0
        total_failures = 0
        any_ok = False
        for name, endpoint in self.state.endpoints.items():
            if name not in self.endpoint_rows:
                self.endpoint_rows[name] = self.endpoint_tree.insert("", END, text=name, values=("未检查", "-", "-", 0, 0))
            total_requests += endpoint.total_count
            total_failures += endpoint.fail_count
            any_ok = any_ok or endpoint.ok_count > 0
            self.endpoint_tree.item(
                self.endpoint_rows[name],
                values=(
                    endpoint.last_status,
                    f"{endpoint.last_ms:.0f} ms" if endpoint.total_count else "-",
                    f"{endpoint.avg_ms:.0f} ms" if endpoint.total_count else "-",
                    endpoint.ok_count,
                    endpoint.fail_count,
                ),
            )

        elapsed_min = max((time.time() - self.state.started_at) / 60, 0.01)
        pressure = total_requests / elapsed_min
        connect = "可连接" if any_ok and total_failures == 0 else "部分异常" if any_ok else "不可连接"
        self.metric_vars["connect"].set(connect)
        self.metric_vars["visitors"].set(str(self.state.observed_marketplace_loads))
        self.metric_vars["downloads"].set(str(self.state.observed_download_probes))
        self.metric_vars["pressure"].set(f"{pressure:.1f} monitor req/min")
        self.metric_vars["live"].set(str(self.state.live_room_count))
        self.metric_vars["ledger"].set(str(self.state.ledger_height))
        apk_mb = self.state.apk_file_size / 1024 / 1024
        self.metric_vars["apk"].set("可下载 %.2f MB" % apk_mb if self.state.apk_available else "未确认")
        peak = self.state.history_peak or {}
        self.metric_vars["peak"].set(
            f"{peak.get('requests', 0)} req/min" if self.state.metrics_available else "未拉取"
        )
        self.summary.set(
            f"商品 {self.state.product_count} · 店铺 {self.state.store_count} · "
            f"信令探测 {self.state.observed_signal_polls} · 本机监控请求 {total_requests} · 失败 {total_failures}"
        )
        self.draw_history_chart()

    def draw_history_chart(self) -> None:
        canvas = self.chart_canvas
        canvas.delete("all")
        width = max(canvas.winfo_width(), 300)
        height = max(canvas.winfo_height(), 150)
        pad = 28
        canvas.create_text(12, 10, anchor="nw", text="服务端真实聚合历史", fill="#1f352f", font=("Microsoft YaHei UI", 10, "bold"))
        if not self.state.metrics_available or not self.state.history_buckets:
            canvas.create_text(
                width / 2,
                height / 2,
                text="配置 Admin Token 后点击“拉取历史波形”",
                fill="#8a5a2b",
                font=("Microsoft YaHei UI", 11, "bold"),
            )
            return
        buckets = self.state.history_buckets[-240:]
        max_requests = max([item.get("requests", 0) for item in buckets] + [1])
        max_downloads = max([item.get("downloads", 0) for item in buckets] + [1])
        max_bytes = max([item.get("bytesOut", 0) for item in buckets] + [1])
        canvas.create_line(pad, height - pad, width - pad, height - pad, fill="#d0ddd8")
        canvas.create_line(pad, pad, pad, height - pad, fill="#d0ddd8")
        self.draw_series(canvas, buckets, "requests", max_requests, "#2f8f83", pad, width, height)
        self.draw_series(canvas, buckets, "downloads", max_downloads, "#d5684e", pad, width, height)
        self.draw_series(canvas, buckets, "bytesOut", max_bytes, "#4f7fcf", pad, width, height)
        canvas.create_text(width - pad, 12, anchor="ne", text="绿=请求 红=下载 蓝=流量", fill="#557069")

    def draw_series(self, canvas, buckets, key, max_value, color, pad, width, height) -> None:
        if len(buckets) < 2:
            return
        points = []
        usable_width = max(1, width - pad * 2)
        usable_height = max(1, height - pad * 2)
        for index, item in enumerate(buckets):
            x = pad + usable_width * index / (len(buckets) - 1)
            y = height - pad - usable_height * (item.get(key, 0) / max_value)
            points.extend([x, y])
        canvas.create_line(*points, fill=color, width=2, smooth=True)

    def log(self, text: str) -> None:
        stamp = datetime.now().strftime("%H:%M:%S")
        self.log_box.insert(END, f"[{stamp}] {text}\n")
        self.log_box.see(END)

    def open_config_location(self) -> None:
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        if not CONFIG_PATH.exists():
            save_config(self.current_config())
        os.startfile(CONFIG_PATH.parent)


def main() -> None:
    root = Tk()
    style = ttk.Style()
    try:
        style.theme_use("clam")
    except Exception:
        pass
    ServerMonitorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
