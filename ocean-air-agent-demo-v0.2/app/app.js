/* Local presentation prototype. Terrain, routes and metrics are illustrative Mock data. */
const $ = (selector) => document.querySelector(selector);
const steps = [...document.querySelectorAll('.trace-step')];
const routes = [...document.querySelectorAll('.scan-path')];
const routeLengths = routes.map((path) => path.getTotalLength());
const totalRouteLength = routeLengths.reduce((sum, length) => sum + length, 0);
const dialog = $('#detailDialog');
const resultPanel = $('.result-panel');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const demo = { running: false, prompt: $('#userMessage').textContent.trim(), coverage: 96, distance: 12.4, area: 482.6, targetArea: 502.1, waypoints: 48 };
let toastTimer;

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

function notify(message) {
  window.clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = window.setTimeout(() => { $('#toast').hidden = true; }, 2600);
}

function setStep(index, state) {
  steps[index].classList.remove('pending', 'running', 'done');
  steps[index].classList.add(state);
  steps[index].querySelector('.step-check').setAttribute('aria-label', { pending: '等待执行', running: '执行中', done: '已完成' }[state]);
}

function paintProgress(progress) {
  const coverage = Math.round(progress * demo.coverage);
  $('#coverageRing').style.setProperty('--coverage', coverage);
  $('#coverageValue').replaceChildren(document.createTextNode(String(coverage)), Object.assign(document.createElement('span'), { textContent: '%' }));
  $('#coveredArea').textContent = (demo.area * progress).toFixed(1) + ' km²';
  let remaining = totalRouteLength * progress;
  let currentPath = routes[0];
  let currentPoint = 0;
  routes.forEach((path, index) => {
    const traversed = Math.max(0, Math.min(routeLengths[index], remaining));
    path.style.strokeDasharray = String(routeLengths[index]);
    path.style.strokeDashoffset = String(routeLengths[index] - traversed);
    if (remaining >= 0) {
      currentPath = path;
      currentPoint = traversed;
    }
    remaining -= routeLengths[index];
  });
  const point = currentPath.getPointAtLength(currentPoint);
  const before = currentPath.getPointAtLength(Math.max(0, currentPoint - 1));
  const after = currentPath.getPointAtLength(Math.min(currentPath.getTotalLength(), currentPoint + 1));
  const angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI;
  $('#vehicleMarker').setAttribute('transform', 'translate(' + point.x + ' ' + point.y + ') rotate(' + angle + ')');
}

function animateProgress(from, to, duration) {
  if (reducedMotion.matches) {
    paintProgress(to);
    return wait(120);
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now) => {
      const fraction = Math.min(1, (now - start) / duration);
      paintProgress(from + (to - from) * fraction);
      if (fraction < 1) window.requestAnimationFrame(frame);
      else resolve();
    };
    window.requestAnimationFrame(frame);
  });
}

async function runMission(prompt = demo.prompt) {
  if (demo.running) return;
  demo.running = true;
  demo.prompt = prompt;
  $('#userMessage').textContent = prompt;
  $('#sendButton').disabled = true;
  $('#replayButton').disabled = true;
  $('#reportButton').disabled = true;
  $('#missionInput').disabled = true;
  $('#mapMode').value = 'route';
  $('#mapFrame').classList.remove('terrain-only');
  $('.map-legend').hidden = false;
  $('#mapOverlay').setAttribute('aria-label', '扫描航迹与岛礁边界');
  resultPanel.classList.add('is-running');
  $('#mapLiveStatus').hidden = false;
  $('#mapLiveStatus span').textContent = '正在解析任务区域';
  $('#understandingText').textContent = '正在解析您的任务需求，并加载演示海域与岛礁边界…';
  $('#agentAnswer').textContent = '任务已开始。以下为本地演示流程，结果将随航迹生成更新。';
  $('#executionTitle').textContent = '模拟验证';
  $('#completionTitle').textContent = '正在规划';
  $('#completionText').textContent = '任务执行中，请稍候';
  steps.forEach((_, index) => setStep(index, 'pending'));
  paintProgress(0);

  try {
    setStep(0, 'running');
    await wait(reducedMotion.matches ? 120 : 850);
    setStep(0, 'done');
    $('#understandingText').textContent = '已理解任务目标：对演示海域进行二维扫描，生成覆盖航迹，并避开岛礁区域。';
    setStep(1, 'running');
    $('#mapLiveStatus span').textContent = '正在生成覆盖航迹';
    await animateProgress(0, .55, 1600);
    setStep(1, 'done');
    setStep(2, 'running');
    $('#completionTitle').textContent = '模拟验证';
    $('#mapLiveStatus span').textContent = '正在演示路径与覆盖结果';
    await animateProgress(.55, 1, 1800);
    setStep(2, 'done');
    $('#executionTitle').textContent = '执行完成';
    $('#agentAnswer').innerHTML = '二维海域扫描演示已完成。<br />本次示例覆盖率 <b>96%</b>，航迹总长度 <b>12.4 km</b>，<br class="wide-only" />可在右侧查看航迹与演示报告。';
    $('#completionTitle').textContent = '执行完成';
    $('#completionText').innerHTML = '任务已完成<br />可查看任务报告';
  } catch (error) {
    $('#completionTitle').textContent = '演示中断';
    $('#completionText').textContent = '请重新演示任务';
    $('#agentAnswer').textContent = '本地演示未完成，请重新尝试。';
    console.error('Local mission playback failed:', error);
    notify('演示未完成，请点击重播重试。');
  } finally {
    demo.running = false;
    $('#sendButton').disabled = false;
    $('#replayButton').disabled = false;
    $('#reportButton').disabled = $('#completionTitle').textContent !== '执行完成';
    $('#missionInput').disabled = false;
    $('#mapLiveStatus').hidden = true;
    resultPanel.classList.remove('is-running');
  }
}

$('#missionForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = $('#missionInput').value.trim();
  if (!prompt) {
    notify('请先输入任务需求。');
    $('#missionInput').focus();
    return;
  }
  if (demo.running) return;
  $('#missionInput').value = '';
  void runMission(prompt);
});
$('#replayButton').addEventListener('click', () => { void runMission(); });

$('#mapMode').addEventListener('change', (event) => {
  const terrainOnly = event.target.value === 'terrain';
  $('#mapFrame').classList.toggle('terrain-only', terrainOnly);
  $('.map-legend').hidden = terrainOnly;
  $('#mapOverlay').setAttribute('aria-label', terrainOnly ? '海域地形模式' : '扫描航迹与岛礁边界');
});

function setExpanded(expanded) {
  resultPanel.classList.toggle('expanded', expanded);
  $('#expandButton').setAttribute('aria-label', expanded ? '收起地图' : '展开地图');
  $('#expandButton').setAttribute('aria-expanded', String(expanded));
  $('#expandButton').title = expanded ? '收起地图（Esc）' : '展开地图';
}
$('#expandButton').setAttribute('aria-expanded', 'false');
$('#expandButton').addEventListener('click', () => setExpanded(!resultPanel.classList.contains('expanded')));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && resultPanel.classList.contains('expanded')) setExpanded(false);
});

function showDialog(title, content) {
  $('#dialogTitle').textContent = title;
  $('#dialogBody').innerHTML = content;
  dialog.showModal();
}
$('#closeDialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
});

const views = {
  collaboration: ['智能协同', '<p>面向无人机与无人艇的海空协同任务工作台。</p><div class="detail-row"><span>空中平台</span><b>UAV-01 · 场景占位</b></div><div class="detail-row"><span>海面平台</span><b>USV-02 · 场景占位</b></div><p>当前为界面原型，尚未连接真实平台、通信或调度服务。</p>'],
  tools: ['工具链路', '<div class="detail-row"><span>01 · 任务理解</span><b>区域与约束解析</b></div><div class="detail-row"><span>02 · 生成路径</span><b>覆盖航迹规划</b></div><div class="detail-row"><span>03 · 模拟验证</span><b>结果与报告输出</b></div><p>上述为演示流程；后续可替换为实际 Agent / Tool 执行事件。</p>'],
  data: ['数据管理', '<div class="detail-row"><span>场景</span><b>深海岩岛 · 虚构示意海域</b></div><div class="detail-row"><span>目标面积</span><b>502.1 km² · Mock</b></div><div class="detail-row"><span>数据状态</span><b>本地演示</b></div><p>底图为 AI 生成视觉素材，不含真实坐标、地形或可导航信息。</p>'],
  resources: ['资源库', '<div class="detail-row"><span>地图素材</span><b>深海岩岛地形底图</b></div><div class="detail-row"><span>品牌氛围</span><b>铜金海岸光影</b></div><div class="detail-row"><span>图标体系</span><b>本地 SVG 矢量图标</b></div><p>素材随项目本地保存。航迹、边界、指北针和指标均为独立网页元素。</p>'],
  settings: ['系统设置', '<div class="detail-row"><span>主题</span><b>H · 曜石黑金深海</b></div><div class="detail-row"><span>运行方式</span><b>离线静态原型 / Mock</b></div><div class="detail-row"><span>动画</span><b>尊重系统减少动态效果设置</b></div><p>当前无需 API Key，也不会向外部服务发送任务内容。</p>']
};
document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    if (view === 'mission') {
      $('#missionInput').focus();
      notify('输入任务需求，或点击地图右上角重播。');
    } else {
      showDialog(...views[view]);
    }
  });
});

$('#reportButton').addEventListener('click', () => {
  showDialog('二维海域扫描 · 演示报告', '<p>本地 Mock 场景 · 仅用于界面展示，不用于实际航行。</p><div class="detail-row"><span>覆盖率</span><b>96%</b></div><div class="detail-row"><span>航迹长度</span><b>12.4 km</b></div><div class="detail-row"><span>已覆盖 / 目标面积</span><b>482.6 / 502.1 km²</b></div><div class="detail-row"><span>航点数量</span><b>48</b></div><p id="reportPrompt"></p><button class="dialog-action" id="downloadReport" type="button">下载演示报告 JSON</button>');
  $('#reportPrompt').textContent = '任务需求：' + demo.prompt;
  $('#downloadReport').addEventListener('click', () => {
    const report = { mode: 'mock-presentation', scene: 'fictional-ocean', generatedAt: new Date().toISOString(), prompt: demo.prompt, metrics: { coveragePercent: demo.coverage, routeLengthKm: demo.distance, coveredAreaKm2: demo.area, targetAreaKm2: demo.targetArea, waypointCount: demo.waypoints }, disclaimer: 'AI-generated terrain and illustrative routes. Not for navigation or actual platform execution.' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ocean-scan-demo-report.json';
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
});
