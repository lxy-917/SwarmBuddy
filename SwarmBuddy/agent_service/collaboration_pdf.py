"""生成三页 A4 海域扫描规划报告，并标明信息来源。"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from datetime import datetime, timedelta, timezone
import math


def _font_path() -> str:
    candidates = [
        Path("C:/Windows/Fonts/NotoSansSC-VF.ttf"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    raise RuntimeError("服务器缺少中文字体，无法生成可读的规划 PDF")


def _text_lines(value: object, width: int) -> list[str]:
    clean = " ".join(str(value or "未提供").split())
    lines = []
    while clean:
        if len(clean) <= width:
            lines.append(clean)
            break
        cut = width
        if clean[cut - 1].isascii() and clean[cut].isascii():
            space = clean.rfind(" ", width // 2, width + 1)
            if space > 0:
                cut = space
        if clean[cut] in "，。；：！？、）》】」』" and cut > 1:
            cut -= 1
        lines.append(clean[:cut].rstrip())
        clean = clean[cut:].lstrip()
    return lines or ["未提供"]


def _finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def render_collaboration_pdf(scan: dict, report: dict) -> bytes:
    """报告中的数值始终取自扫描数据，包括引用知识库的报告。"""
    import matplotlib

    matplotlib.use("Agg")
    matplotlib.rcParams["pdf.fonttype"] = 42
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.font_manager import FontProperties
    from matplotlib.patches import FancyBboxPatch, Polygon

    font = FontProperties(fname=_font_path())
    ink, muted, teal, gold = "#17323a", "#64777b", "#2f7d83", "#b78249"
    pale, rule = "#edf5f4", "#dce7e6"
    knowledge = report.get("knowledge_items") or []
    total_pages = 3
    source = "示例海域" if scan.get("source") == "demo" else "已导入海域数据"

    try:
        generated = datetime.fromisoformat(str(report.get("generated_at", "")).replace("Z", "+00:00"))
        generated_label = generated.astimezone(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M 北京时间")
    except ValueError:
        generated_label = ""

    def page(number: int, eyebrow: str):
        fig = plt.figure(figsize=(8.27, 11.69), facecolor="white")
        ax = fig.add_axes((0, 0, 1, 1))
        ax.set_axis_off()
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.text(.06, .958, "SwarmBuddy  /  智能协同", fontproperties=font, fontsize=9, color=teal, va="center")
        ax.text(.94, .958, f"{number:02d} / {total_pages:02d}", fontproperties=font, fontsize=9, color=muted, ha="right", va="center")
        ax.add_patch(FancyBboxPatch((.06, .931), .88, .006, boxstyle="round,pad=0,rounding_size=.003", facecolor=teal, edgecolor="none"))
        ax.text(.06, .91, eyebrow, fontproperties=font, fontsize=8, color=gold, va="top")
        ax.plot([.06, .94], [.067, .067], color=rule, linewidth=.8)
        ax.text(.06, .045, "规划评估资料 · 指标为规划计算或估计，实施前须复核", fontproperties=font, fontsize=7.5, color=muted)
        ax.text(.94, .045, generated_label, fontproperties=font, fontsize=7.5, color=muted, ha="right")
        return fig, ax

    def heading(ax, label: str, y: float, size: float = 12, x: float = .06):
        ax.text(x, y, label, fontproperties=font, fontsize=size, fontweight="bold", color=ink, va="top")

    def body(ax, value: object, x: float, y: float, width: int, *, size: float = 9,
             step: float = .021, max_lines: int = 12, color: str = ink) -> float:
        lines = _text_lines(value, width)
        if len(lines) > max_lines:
            raise ValueError("报告内容超出页面可排版范围，请缩短相应段落")
        for line in lines:
            ax.text(x, y, line, fontproperties=font, fontsize=size, color=color, va="top")
            y -= step
        return y

    def numbered(ax, items: list[str], x: float, y: float, width: int, *, size: float = 8.5,
                 step: float = .019, gap: float = .013, max_lines: int = 5) -> float:
        for index, item in enumerate(items):
            y = body(ax, f"{index + 1:02d}  {item}", x, y, width, size=size, step=step, max_lines=max_lines) - gap
        return y

    def metric(ax, label: str, value: str, x: float, y: float):
        ax.text(x, y, label, fontproperties=font, fontsize=8, color=muted, va="top")
        ax.text(x, y - .025, value, fontproperties=font, fontsize=15, fontweight="bold", color=ink, va="top")

    def save(pdf, fig):
        pdf.savefig(fig, facecolor="white")
        plt.close(fig)

    target, covered = scan.get("target_area_m2"), scan.get("covered_area_m2")
    uncovered = max(0, target - covered) if _finite(target) and _finite(covered) else None
    speed, length = scan.get("speed_knots"), scan.get("path_length_m")
    duration = scan.get("estimated_duration_hours")
    if not _finite(duration):
        duration = length / (speed * 1852) if _finite(length) and _finite(speed) and speed > 0 else None

    def area(value):
        return f"{value / 1_000_000:.2f} km²" if _finite(value) else "待计算"

    def distance(value):
        return f"{value / 1000:.1f} km" if _finite(value) else "待计算"

    def plain(value, unit=""):
        return f"{value:g}{unit}" if _finite(value) else "待计算"

    output = BytesIO()
    with PdfPages(output) as pdf:
        # 第 1 页：摘要和实际规划航线。
        fig, ax = page(1, "01  方案概览")
        heading(ax, "海域扫描规划评估报告", .882, 21)
        ax.text(.06, .846, f"数据来源：{source}    规划自检：{'通过' if scan.get('validated') else '待核验'}", fontproperties=font, fontsize=9, color=muted)
        ax.add_patch(FancyBboxPatch((.06, .706), .88, .108, boxstyle="round,pad=.012,rounding_size=.012", facecolor=pale, edgecolor="none"))
        heading(ax, "综合评估", .792, 11, .078)
        body(ax, report.get("assessment"), .078, .765, 54, max_lines=4, size=8.8, step=.019)

        heading(ax, "规划航迹与关键指标", .674, 12)
        map_ax = fig.add_axes((.075, .330, .575, .324), facecolor="#f8fbfb")
        map_data = scan.get("map") or {}
        rings = map_data.get("region") or []
        waypoints = map_data.get("waypoints") or []
        if rings and waypoints:
            for ring in rings:
                map_ax.add_patch(Polygon(ring, closed=True, facecolor="#e9f4f2", edgecolor="#65a5a5", linewidth=1.1, zorder=1))
            for ring in map_data.get("obstacles") or []:
                map_ax.add_patch(Polygon(ring, closed=True, facecolor="#d5b992", edgecolor="#a87743", linewidth=.7, zorder=2))
            map_ax.plot([p[0] for p in waypoints], [p[1] for p in waypoints], color="#348fbc", linewidth=.95, zorder=3)
            map_ax.scatter(waypoints[0][0], waypoints[0][1], s=23, color=teal, zorder=4)
            all_points = [point for ring in rings for point in ring]
            min_x, max_x = min(p[0] for p in all_points), max(p[0] for p in all_points)
            min_y, max_y = min(p[1] for p in all_points), max(p[1] for p in all_points)
            margin = max(max_x - min_x, max_y - min_y) * .07
            map_ax.set_xlim(min_x - margin, max_x + margin)
            map_ax.set_ylim(max_y + margin, min_y - margin)
            map_ax.set_aspect("equal", adjustable="box")
            map_ax.set_xticks([])
            map_ax.set_yticks([])
        else:
            bounds = scan.get("bounds") or {}
            if all(_finite(bounds.get(key)) for key in ("west", "east", "south", "north")):
                map_ax.set_xlim(bounds["west"], bounds["east"])
                map_ax.set_ylim(bounds["south"], bounds["north"])
            coords = (scan.get("route_geojson") or {}).get("coordinates") or []
            if coords:
                map_ax.plot([point[0] for point in coords], [point[1] for point in coords], color="#348fbc", linewidth=.95)
                map_ax.scatter(coords[0][0], coords[0][1], s=23, color=teal, zorder=3)
            map_ax.grid(color="#dce9e9", linewidth=.5)
            map_ax.tick_params(axis="both", labelsize=7, colors=muted)
            map_ax.ticklabel_format(useOffset=False)
        for spine in map_ax.spines.values():
            spine.set_edgecolor("#cddedd")
        ax.text(.075, .313, "目标区域  /  规划航迹  /  障碍或禁入区域", fontproperties=font, fontsize=7.5, color=muted)
        metric(ax, "预计覆盖率", f"{scan['planned_coverage_percent']:.1f}%" if _finite(scan.get("planned_coverage_percent")) else "待计算", .69, .614)
        metric(ax, "规划航程", distance(length), .69, .529)
        metric(ax, "预计耗时", f"{duration:.1f} 小时" if _finite(duration) else "待计算", .69, .444)
        metric(ax, "航点数量", plain(scan.get("waypoint_count")), .69, .359)

        ax.plot([.06, .94], [.292, .292], color=rule, linewidth=.8)
        heading(ax, "扫描数据摘要", .276, 11)
        ax.text(.06, .235, f"目标面积   {area(target)}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.37, .235, f"预计覆盖   {area(covered)}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.69, .235, f"未覆盖   {area(uncovered)}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.06, .194, f"扫描间距   {plain(scan.get('spacing_m'), ' m')}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.37, .194, f"避障距离   {plain(scan.get('obstacle_buffer_m'), ' m')}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.69, .194, f"预计航速   {plain(speed, ' 节')}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.06, .153, f"障碍物数量   {plain(scan.get('obstacle_count'))}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.37, .153, f"禁航区数量   {plain(scan.get('no_go_zone_count'))}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.06, .112, "图示为规划航迹，不代表现场已完成航行或测量。", fontproperties=font, fontsize=8, color=muted)
        save(pdf, fig)

        # 第 2 页：集中解释规划指标，避免页面内容过于稀疏。
        fig, ax = page(2, "02  指标解读")
        heading(ax, "覆盖、航线与作业条件", .881, 20)
        ax.text(.06, .844, "以下结论基于规划输出及明确的计算口径。", fontproperties=font, fontsize=9, color=muted)
        heading(ax, "覆盖结果", .805, 12)
        body(ax, report.get("coverage_analysis"), .075, .770, 56, size=9.2, step=.022, max_lines=6)
        ax.add_patch(FancyBboxPatch((.06, .533), .88, .078, boxstyle="round,pad=.008,rounding_size=.009", facecolor=pale, edgecolor="none"))
        ax.text(.08, .583, f"目标面积  {area(target)}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.51, .583, f"预计覆盖  {area(covered)}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.08, .550, f"未覆盖  {area(uncovered)}", fontproperties=font, fontsize=9, color=ink)
        ax.text(.51, .550, f"覆盖率  {scan['planned_coverage_percent']:.1f}%" if _finite(scan.get("planned_coverage_percent")) else "覆盖率  待计算", fontproperties=font, fontsize=9, color=ink)
        heading(ax, "航线与效率", .505, 12)
        body(ax, report.get("route_analysis"), .075, .470, 56, size=9.2, step=.022, max_lines=6)
        heading(ax, "作业时间与实施条件", .305, 12)
        body(ax, report.get("execution_analysis"), .075, .270, 56, size=9.2, step=.022, max_lines=6)
        ax.plot([.06, .94], [.126, .126], color=rule, linewidth=.8)
        body(ax, "口径提示：覆盖按扫描线半间距形成的几何覆盖带计算，连接航段不计入；预计耗时不包含停航、转弯及现场作业余量。", .075, .110, 66, size=8, step=.018, max_lines=2, color=muted)
        save(pdf, fig)

        # 第 3 页：风险、核验依据、建议行动与引用来源。
        fig, ax = page(3, "03  核验与实施")
        heading(ax, "风险、资料缺口与实施建议", .881, 20)
        ax.text(.06, .844, "把每项判断落实到资料或核验动作；尚无现场证据的事项不作安全结论。", fontproperties=font, fontsize=9, color=muted)
        ax.plot([.5, .5], [.455, .815], color=rule, linewidth=.8)
        heading(ax, "主要风险与影响", .805, 12, .06)
        heading(ax, "建议采取的措施", .805, 12, .53)
        risk_y = numbered(ax, (report.get("risks") or [])[:3], .07, .762, 27, size=9, step=.0165, gap=.004, max_lines=4)
        action_y = numbered(ax, (report.get("recommendations") or [])[:4], .54, .762, 27, size=9, step=.0165, gap=.004, max_lines=4)
        if min(risk_y, action_y) < .455:
            raise ValueError("风险或实施建议超出页面范围")
        ax.plot([.06, .94], [.440, .440], color=rule, linewidth=.8)
        heading(ax, "待补充或核验资料", .417, 11, .06)
        heading(ax, "专业依据与计算口径", .417, 11, .53)
        gap_y = numbered(ax, (report.get("data_gaps") or [])[:3], .07, .392, 27, size=9, step=.0165, gap=.004, max_lines=4)
        if gap_y < .166:
            raise ValueError("待补资料超出页面范围")
        if knowledge:
            y = .400
            for index, item in enumerate(knowledge[:3]):
                y = body(ax, f"{index + 1:02d}  {item.get('point', '')}", .54, y, 28, size=8.2, step=.0155, max_lines=3)
                source_text = str(item.get("source") or "未标注来源")
                if item.get("page"):
                    source_text += f"，第 {item['page']} 页"
                if len(source_text) > 55:
                    source_text = source_text[:39] + "…" + source_text[-15:]
                y = body(ax, f"来源：{source_text}", .54, y - .002, 30, size=7.5, step=.013, max_lines=2, color=teal) - .002
            if y < .163:
                raise ValueError("知识库引用超出页面范围")
        else:
            method_items = [
                f"目标面积：扣除 {plain(scan.get('obstacle_buffer_m'), ' m')} 避障缓冲后的可航区域。",
                f"覆盖率：按 {plain(scan.get('spacing_m'), ' m')} 扫描间距的半宽覆盖带计算，非载荷实测。",
                "耗时：按规划航程及预计航速换算，不含现场作业余量。" if _finite(speed) else "耗时：缺少预计航速，暂不可计算。",
            ]
            method_y = numbered(ax, method_items, .54, .378, 27, size=8.8, step=.017, gap=.011, max_lines=3)
            if method_y < .163:
                raise ValueError("指标口径超出页面范围")
        ax.plot([.06, .94], [.151, .151], color=rule, linewidth=.8)
        ax.text(.075, .132, "数据来源与适用范围", fontproperties=font, fontsize=8.5, color=ink, va="top")
        body(ax, f"扫描结果：{source}；分析建议：会话中选定的智能体回复；会话 ID：{report.get('source_session_id', '')}。", .075, .112, 66, size=7.8, step=.016, max_lines=2, color=muted)
        save(pdf, fig)

    return output.getvalue()
