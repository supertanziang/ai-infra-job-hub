(() => {
  'use strict';

  const STORAGE_KEY = 'aiinfra-application-records-v1';
  const VAULT_DB = 'aiinfra-profile-v1';
  const STATUSES = new Set(['未开始', '已查看', '已投递', '笔试', '面试', 'Offer', '已结束']);
  const APPLIED_STATUSES = new Set(['已投递', '笔试', '面试', 'Offer', '已结束']);
  const TIER_ORDER = { '大厂': 0, '央国企': 1, '研究院所': 1, '中厂': 2, '成长公司': 3 };
  const CITY_PRIORITY = ['上海', '北京', '杭州', '深圳', '苏州', '武汉', '西安'];
  const PAGE_SIZE = 20;
  const COMPANY_ALIASES = new Map([['阿里巴巴/阿里云', '阿里巴巴'], ['阿里云', '阿里巴巴'], ['美团longcat', '美团'], ['字节跳动seed', '字节跳动']]);
  const state = { data: null, tab: 'jobs', city: 'all', mode: 'all', apply: 'all', progressFilter: 'all', sort: 'city', query: '', radarQuery: '', radarCategory: 'all', radarCity: 'all', pages: { jobs: 1, radar: 1, progress: 1 }, expanded: { jobs: new Set(), progress: new Set() }, currentJobId: null, records: loadRecords(), profilePassword: null, profile: null };
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const safeUrl = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : '#'; } catch { return '#'; } };
  const dates = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' });
  let toastTimer;

  function loadRecords() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }
  function saveRecords() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records)); return true; }
    catch { toast('浏览器未能保存记录，请先导出备份'); return false; }
  }
  function toast(message) {
    const node = $('#toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 2600);
  }
  function radarJob(item) {
    return { id: `radar-${encodeURIComponent(companyIdentity(item.company).key)}`, company: item.company, tier: item.tier, city: item.city, regions: item.regions || [], title: item.focus || '官方招聘入口', type: '具体岗位与资格待核对', mode: 'radar', score: item.score || 0, postedAt: '', url: item.url, statusUrl: item.url, tags: [item.ownership, item.orgType, item.category].filter(Boolean), reason: item.note, evidence: '已核对公司或机构官方入口；不代表具体职位当前开放。', sourceCheckedAt: item.sourceCheckedAt, entryType: item.entryType };
  }
  function catalogJobs() {
    if (!state.data) return [];
    const companies = new Set(state.data.jobs.map(job => companyIdentity(job.company).key));
    return [...state.data.jobs, ...state.data.radar.filter(item => !companies.has(companyIdentity(item.company).key)).map(radarJob)];
  }
  function jobById(id) { return state.jobIndex?.get(id); }
  function recordJob(id, record = state.records[id]) { return jobById(id) || record?.jobSnapshot; }
  function companyHasApplied(company) {
    const key = companyIdentity(company).key;
    return trackedRecords().some(([id, record]) => isApplied(record) && companyIdentity(recordJob(id, record)?.company).key === key);
  }
  function jobSnapshot(job) { return { id: job.id, company: job.company, title: job.title, city: job.city, url: job.url, statusUrl: job.statusUrl || job.url }; }
  function isApplied(record) { return Boolean(record?.appliedAt) || APPLIED_STATUSES.has(record?.status); }
  function isFollowup(record) { return Boolean(record?.nextDate && record.nextDate <= new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) && !['Offer', '已结束'].includes(record.status)); }
  function trackedRecords() { return Object.entries(state.records).filter(([, record]) => record && STATUSES.has(record.status)); }
  function companyIdentity(company) {
    const original = String(company || '公司待确认').normalize('NFKC').trim();
    const normalized = original.replace(/\s+/g, '').toLowerCase();
    const label = COMPANY_ALIASES.get(normalized) || original;
    return { key: label.replace(/\s+/g, '').toLowerCase(), label };
  }
  function groupCompanies(items, getCompany = item => item.company) {
    const groups = new Map();
    for (const item of items) {
      const { key, label } = companyIdentity(getCompany(item));
      if (!groups.has(key)) groups.set(key, { key, company: label, items: [] });
      groups.get(key).items.push(item);
    }
    return [...groups.values()];
  }
  function paginate(view, groups, detail = '') {
    const total = groups.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(pages, Math.max(1, state.pages[view] || 1));
    state.pages[view] = page;
    const start = (page - 1) * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, total);
    const viewName = { jobs: '岗位与公司', radar: '公司雷达', progress: '投递进度' }[view];
    const options = Array.from({ length: pages }, (_, i) => `<option value="${i + 1}"${i + 1 === page ? ' selected' : ''}>${i + 1}</option>`).join('');
    const controls = total ? `<div class="pagination-controls"><button type="button" class="page-button" data-page-view="${view}" data-page="${page - 1}"${page === 1 ? ' disabled' : ''}>上一页</button><label class="pagination-page">第 <select data-page-select="${view}" aria-label="${viewName}页码">${options}</select> / ${pages} 页</label><button type="button" class="page-button" data-page-view="${view}" data-page="${page + 1}"${page === pages ? ' disabled' : ''}>下一页</button></div>` : '';
    document.querySelectorAll(`[data-pagination="${view}"]`).forEach(node => {
      node.hidden = total === 0 && node.classList.contains('pagination-bottom');
      node.innerHTML = `<div class="pagination-info"><strong>${total} 家${view === 'progress' ? '公司' : '单位'}${detail ? ` · ${escapeHtml(detail)}` : ''}</strong><span>${total ? `本页 ${start + 1}–${end} 家 · 每页 ${PAGE_SIZE} 家` : '当前筛选暂无结果'}</span></div>${controls}`;
    });
    return groups.slice(start, end);
  }
  function changePage(view, page) {
    if (!state.data || !Object.hasOwn(state.pages, view) || !Number.isInteger(page)) return;
    state.pages[view] = page;
    ({ jobs: renderJobs, radar: renderRadar, progress: renderProgress }[view])();
    const pagination = document.querySelector(`[data-pagination="${view}"]`);
    pagination.querySelector('select')?.focus({ preventScroll: true });
    pagination.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function fetchJobs() {
    $('#checkedAtHeader').textContent = '正在更新岗位数据';
    try {
      const response = await fetch(`./jobs.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.jobs) || !Array.isArray(data.radar)) throw new Error('数据格式不正确');
      state.data = data;
      state.jobIndex = new Map([...data.radar.map(radarJob), ...data.jobs].map(job => [job.id, job]));
      let upgraded = false;
      for (const [id, record] of Object.entries(state.records)) {
        const job = jobById(id);
        if (record && job && !record.jobSnapshot) { record.jobSnapshot = jobSnapshot(job); upgraded = true; }
      }
      if (upgraded) saveRecords();
      render();
      return true;
    } catch (error) {
      $('#checkedAtHeader').textContent = '岗位数据暂不可用';
      $('#jobList').innerHTML = '<div class="empty-state">岗位数据暂时加载失败，请稍后刷新页面。</div>';
      toast('岗位数据加载失败');
      return false;
    }
  }

  function renderSummary() {
    const { jobs, radar, checkedAt } = state.data;
    const checked = new Date(checkedAt);
    const stale = Number.isFinite(checked.getTime()) && Date.now() - checked.getTime() > 36 * 60 * 60 * 1000;
    const dateText = Number.isFinite(checked.getTime()) ? dates.format(checked) : '日期待核验';
    $('#checkedAtHeader').textContent = `最近核验 ${dateText}${stale ? ' · 待更新' : ''}`;
    $('#footerCheckedAt').textContent = dateText;
    $('#jobCount').textContent = jobs.length;
    $('#directCount').textContent = jobs.filter(job => job.mode === 'direct').length;
    $('#companyCount').textContent = groupCompanies(catalogJobs()).length;
    $('#tabJobCount').textContent = groupCompanies(catalogJobs()).length;
    $('#tabRadarCount').textContent = groupCompanies(radar).length;
    updateRecordMetrics();
  }
  function updateRecordMetrics() {
    const items = progressItems();
    const groups = groupCompanies(items, item => item.job.company);
    const applied = groups.filter(group => group.items.some(item => isApplied(item.record))).length;
    const catalog = typeof catalogJobs === 'function' ? catalogJobs() : state.data?.jobs || [];
    const universe = groupCompanies([...catalog, ...items.map(item => item.job)]);
    $('#appliedCount').textContent = applied;
    $('#unappliedCount').textContent = Math.max(0, universe.length - applied);
    $('#tabProgressCount').textContent = groups.length;
    $('#progressApplied').textContent = applied;
    $('#progressUnapplied').textContent = groups.filter(group => progressStage(group) === '待投递').length;
    $('#progressFollowup').textContent = groups.filter(group => group.items.some(item => isFollowup(item.record))).length;
    $('#progressRecorded').textContent = groups.length;
  }

  function cityRank(job) {
    const rank = CITY_PRIORITY.findIndex(city => String(job.city || '').includes(city) || (job.regions || []).includes(city));
    return rank === -1 ? CITY_PRIORITY.length : rank;
  }
  function getFilteredJobs() {
    const query = state.query.trim().toLowerCase();
    return catalogJobs().filter(job => {
      if (state.city !== 'all' && !String(job.city || '').includes(state.city) && !(job.regions || []).includes(state.city)) return false;
      if (state.mode === 'direct' && job.mode !== 'direct') return false;
      if (state.mode === 'portal' && job.mode === 'direct') return false;
      if (state.apply === 'applied' && !companyHasApplied(job.company)) return false;
      if (state.apply === 'unapplied' && companyHasApplied(job.company)) return false;
      const haystack = [job.company, job.title, job.city, job.reason, ...(job.tags || []), ...(job.regions || [])].join(' ').toLowerCase();
      return !query || haystack.includes(query);
    }).sort((a, b) => {
      if (state.sort === 'city' && state.city === 'all') return cityRank(a) - cityRank(b) || b.score - a.score || (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9);
      if (state.sort === 'tier') return (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || b.score - a.score;
      if (state.sort === 'new') return (b.postedAt || '').localeCompare(a.postedAt || '') || b.score - a.score;
      return b.score - a.score || (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9);
    });
  }
  function jobRole(job, primary = false) {
    const record = state.records[job.id];
    const isDirect = job.mode === 'direct';
    const isRadar = job.mode === 'radar';
    const sourceText = isRadar ? '公司入口 · 岗位待筛选' : job.postedAt ? `官网发布 ${escapeHtml(job.postedAt)}` : '已核验官网来源';
    return `<section class="company-job${primary ? ' primary-job' : ''}" id="${escapeHtml(job.id)}" data-job-id="${escapeHtml(job.id)}">
      <div class="role-title"><h4>${escapeHtml(job.title)}</h4>${primary ? '' : `<span class="role-score">匹配 ${escapeHtml(job.score)}</span>`}</div>
      <div class="job-meta"><span>${escapeHtml(job.city)}</span><span class="meta-dot">·</span><span>${escapeHtml(job.type)}</span><span class="meta-dot">·</span><span class="${isDirect ? 'direct' : 'portal'}">${isDirect ? '职位直达' : isRadar ? '招聘入口' : '项目入口'}</span></div>
      <p class="job-reason">${escapeHtml(job.reason)}</p>
      <div class="tags">${(job.tags || []).slice(0, 5).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="job-bottom"><span class="job-source" title="${escapeHtml(job.evidence)}">${sourceText}</span><div class="job-actions"><button class="record-button ${record?.status && record.status !== '未开始' ? 'has-state' : ''}" type="button" data-record="${escapeHtml(job.id)}">${record?.status && record.status !== '未开始' ? escapeHtml(record.status) : '记录进度'}</button><a class="link-button" href="${safeUrl(job.url)}" target="_blank" rel="noopener noreferrer" data-openjob="${escapeHtml(job.id)}">${isDirect ? '去官网投递' : isRadar ? (job.entryType === '招聘站' ? '进入招聘站' : '访问官方网站') : '打开招聘项目'} <span aria-hidden="true">↗</span></a></div></div>
    </section>`;
  }
  function jobCard(group) {
    const [first, ...others] = group.items;
    const open = state.expanded.jobs.has(group.key) ? ' open' : '';
    return `<article class="job-card company-job-card" data-company-key="${escapeHtml(group.key)}">
      <div class="job-top"><div class="company-line"><span class="company-avatar" aria-hidden="true">${escapeHtml(group.company.slice(0, 1))}</span><div><span class="company-name">${escapeHtml(group.company)}</span><span class="tier-label">${escapeHtml(first.tier)}</span><span class="company-role-count">${group.items.length} 个岗位 / 入口${companyHasApplied(group.company) ? ' · 已投递' : ''}</span></div></div><div class="score" title="当前展示岗位的人工匹配分，不代表录用概率"><strong>${escapeHtml(first.score)}</strong><span>/ 100</span></div></div>
      ${jobRole(first, true)}
      ${others.length ? `<details class="company-details" data-company-details="jobs" data-company-key="${escapeHtml(group.key)}"${open}><summary>查看其他 ${others.length} 个岗位</summary><div class="company-more-jobs">${others.map(job => jobRole(job)).join('')}</div></details>` : ''}
    </article>`;
  }
  function renderJobs() {
    if (!state.data) return;
    const list = getFilteredJobs();
    const groups = groupCompanies(list);
    const verified = list.filter(job => job.mode !== 'radar').length;
    const entries = list.length - verified;
    $('#jobList').innerHTML = paginate('jobs', groups, `${verified} 个已核验岗位 / 项目${entries ? ` · ${entries} 个公司入口` : ''}`).map(jobCard).join('');
    $('#emptyJobs').hidden = list.length > 0;
    const cityHasJobs = state.city === 'all' || catalogJobs().some(job => String(job.city || '').includes(state.city) || (job.regions || []).includes(state.city));
    $('#emptyJobs').textContent = cityHasJobs ? '没有符合筛选条件的岗位或单位。试试调整城市或关键词。' : `暂未收录${state.city}的相关岗位或单位，试试其他城市或全部城市。`;
    $('#sortSelect').value = state.sort;
    $('#cityToggleLabel').textContent = state.city === 'all' ? '筛选城市' : `城市：${state.city}`;
    document.querySelectorAll('[data-city]').forEach(button => { const active = button.dataset.city === state.city; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    document.querySelectorAll('[data-mode]').forEach(button => button.classList.toggle('active', button.dataset.mode === state.mode));
    document.querySelectorAll('[data-apply]').forEach(button => button.classList.toggle('active', button.dataset.apply === state.apply));
  }
  function setCityFiltersOpen(open) {
    $('#cityFilters').hidden = !open;
    $('#cityToggle').setAttribute('aria-expanded', String(open));
  }
  function renderRadar() {
    if (!state.data) return;
    const query = state.radarQuery.trim().toLowerCase();
    const items = state.data.radar.filter(item => {
      if (state.radarCity !== 'all' && !(item.regions || []).includes(state.radarCity) && !String(item.city || '').includes(state.radarCity)) return false;
      if (state.radarCategory === 'foreign') {
        if (item.ownership !== '外企') return false;
      } else if (state.radarCategory === 'startup') {
        if (item.orgType !== '创业/成长' && item.tier !== '成长公司') return false;
      } else if (state.radarCategory === '央国企') {
        if (item.ownership !== '央国企' && item.category !== '央国企' && item.tier !== '央国企') return false;
      } else if (state.radarCategory !== 'all' && item.category !== state.radarCategory) return false;
      return [item.company, item.city, item.focus, item.note, item.category, item.ownership, item.orgType, ...(item.regions || [])].join(' ').toLowerCase().includes(query);
    }).sort((a, b) => b.score - a.score || (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9) || a.company.localeCompare(b.company, 'zh-CN'));
    const groups = groupCompanies(items);
    $('#radarList').innerHTML = paginate('radar', groups).map(group => {
      const item = group.items[0];
      const meta = [...new Set([item.ownership, item.orgType, item.category].filter(Boolean))].join(' · ');
      return `<article class="radar-card" data-company-key="${escapeHtml(group.key)}"><div class="radar-head"><strong>${escapeHtml(group.company)}</strong><span>匹配 ${escapeHtml(item.score)}</span></div><div class="radar-city">${escapeHtml(meta)} · ${escapeHtml(item.city)}</div><p class="radar-focus">${escapeHtml(item.focus)}</p><p class="radar-note">${escapeHtml(item.note)}</p><div class="job-actions radar-actions"><button class="record-button" type="button" data-record="${escapeHtml(radarJob(item).id)}">记录进度</button><a class="link-button" href="${safeUrl(item.url)}" target="_blank" rel="noopener noreferrer" data-openjob="${escapeHtml(radarJob(item).id)}">${item.entryType === '招聘站' ? '进入招聘站' : '访问官方网站'} <span aria-hidden="true">↗</span></a></div></article>`;
    }).join('') || '<div class="empty-state">没有找到符合条件的单位，试试调整地区、分类或关键词。</div>';
    document.querySelectorAll('[data-category]').forEach(button => { const active = button.dataset.category === state.radarCategory; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
    $('#radarCityLabel').textContent = state.radarCity === 'all' ? '筛选地区' : `地区：${state.radarCity}`;
    document.querySelectorAll('[data-radar-city]').forEach(button => { const active = button.dataset.radarCity === state.radarCity; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  }
  function setRadarCitiesOpen(open) {
    $('#radarCityFilters').hidden = !open;
    $('#radarCityToggle').setAttribute('aria-expanded', String(open));
  }
  function validRecordDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
  }
  function recordTime(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : '';
  }
  function historyKey(value) {
    let hash = 2166136261;
    for (const c of value) { hash ^= c.codePointAt(0); hash = Math.imul(hash, 16777619); }
    return (hash >>> 0).toString(36);
  }
  function normalizeProgressRecord(id, raw = {}) {
    const text = (value, length) => typeof value === 'string' ? value.slice(0, length) : '';
    const status = STATUSES.has(raw.status) ? raw.status : '未开始';
    const history = Array.isArray(raw.history) ? raw.history.filter(event => event && typeof event === 'object' && STATUSES.has(event.status)).map(event => {
      const entry = { status: event.status, occurredAt: recordTime(event.occurredAt), loggedAt: recordTime(event.loggedAt), label: text(event.label, 120), note: text(event.note, 500), nextDate: validRecordDate(event.nextDate), nextAction: text(event.nextAction, 120), kind: event.kind === 'legacy' ? 'legacy' : 'event' };
      return { ...entry, id: text(event.id, 160) || `event-${historyKey(JSON.stringify(entry))}` };
    }) : [];
    if (!history.length && STATUSES.has(raw.status)) history.push({ id: `legacy-${historyKey(id)}`, status, occurredAt: recordTime(raw.updatedAt), loggedAt: '', label: '历史记录导入', note: text(raw.note, 500), nextDate: validRecordDate(raw.nextDate), nextAction: text(raw.nextAction, 120), kind: 'legacy' });
    return { ...raw, status, note: text(raw.note, 500), nextDate: validRecordDate(raw.nextDate), nextAction: text(raw.nextAction, 120), updatedAt: recordTime(raw.updatedAt), appliedAt: recordTime(raw.appliedAt), history };
  }
  function progressItems() {
    const catalog = new Map((typeof catalogJobs === 'function' ? catalogJobs() : state.data?.jobs || []).map(job => [job.id, job]));
    return trackedRecords().map(([id, raw]) => {
      const job = catalog.get(id) || raw.jobSnapshot || { id, company: '历史记录（公司待确认）', title: `未找到职位信息 · ${id}`, city: '城市待确认', url: '' };
      return { job: { ...job, id }, record: normalizeProgressRecord(id, raw) };
    });
  }
  function stageForStatus(status) { return ['未开始', '已查看'].includes(status) ? '待投递' : status; }
  function progressStage(group) {
    const stages = group.items.map(item => stageForStatus(item.record.status));
    return ['Offer', '面试', '笔试', '已投递', '待投递'].find(stage => stages.includes(stage)) || '已结束';
  }
  function formatRecordTime(value) {
    const valid = recordTime(value);
    return valid ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(valid)) : '日期未记录';
  }
  function inputRecordTime() { const date = new Date(); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }
  function progressTimeline(record) {
    const history = [...record.history].sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || '') || (b.loggedAt || '').localeCompare(a.loggedAt || ''));
    return `<ol class="progress-timeline">${history.map(event => `<li data-event-id="${escapeHtml(event.id)}"><div class="timeline-meta"><strong>${escapeHtml(event.label || event.status)}</strong><time>${escapeHtml(formatRecordTime(event.occurredAt))}</time></div><span class="timeline-stage">${escapeHtml(event.status)}</span>${event.note ? `<p>${escapeHtml(event.note)}</p>` : ''}${event.nextDate || event.nextAction ? `<p class="timeline-next">当时的跟进安排：${escapeHtml([event.nextDate, event.nextAction].filter(Boolean).join(' · '))}</p>` : ''}${event.kind === 'legacy' ? '<small>由旧记录迁移，仅保留已知信息。</small>' : ''}</li>`).join('')}</ol>`;
  }
  function progressDue(record) {
    if (!record.nextDate && !record.nextAction) return '<span class="next-unset">未安排下一步</span>';
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const due = isFollowup(record);
    const label = due ? (record.nextDate < today ? '逾期' : '今天') : '';
    return `<span class="next-followup${due ? ' is-due' : ''}">${label ? `<b>${label}</b> ` : ''}${escapeHtml([record.nextDate, record.nextAction].filter(Boolean).join(' · '))}</span>`;
  }
  function progressRow({ job, record }) {
    const link = safeUrl(job.statusUrl || job.url);
    return `<section class="progress-role" data-job-id="${escapeHtml(job.id)}"><div class="progress-role-top"><div><div class="progress-company">${escapeHtml(job.city || '城市待确认')}</div><h4 class="progress-title">${escapeHtml(job.title)}</h4></div><span class="progress-status" data-stage="${escapeHtml(stageForStatus(record.status))}">${escapeHtml(record.status)}</span></div><div class="role-next">${progressDue(record)}</div>${record.note ? `<p class="progress-latest-note">${escapeHtml(record.note)}</p>` : ''}<div class="progress-actions-row"><button class="progress-edit" type="button" data-record="${escapeHtml(job.id)}">＋ 更新进展 / 跟进</button>${link !== '#' ? `<a href="${link}" target="_blank" rel="noopener noreferrer">打开官网核对 ↗</a>` : ''}</div><details class="timeline-details"><summary>进展时间线 <span>${record.history.length} 条</span></summary>${progressTimeline(record)}</details></section>`;
  }
  function progressCard(group) {
    const stage = progressStage(group);
    const ordered = [...group.items].sort((a, b) => Number(stageForStatus(b.record.status) === stage) - Number(stageForStatus(a.record.status) === stage) || (b.record.updatedAt || '').localeCompare(a.record.updatedAt || ''));
    const [first, ...others] = ordered;
    const open = state.expanded.progress.has(group.key) ? ' open' : '';
    const updatedAt = group.items.map(item => item.record.updatedAt).sort().at(-1);
    const next = group.items.filter(item => item.record.nextDate && !['已结束', 'Offer'].includes(item.record.status)).sort((a, b) => a.record.nextDate.localeCompare(b.record.nextDate))[0];
    const visited = new Set(group.items.flatMap(item => item.record.history.map(event => stageForStatus(event.status))));
    const steps = ['待投递', '已投递', '笔试', '面试', 'Offer'];
    return `<article class="company-progress-card" data-company-key="${escapeHtml(group.key)}" data-company-stage="${escapeHtml(stage)}"><div class="company-progress-head"><div><strong>${escapeHtml(group.company)}</strong><p>${group.items.length} 个岗位 / 入口 · 最近更新 ${escapeHtml(formatRecordTime(updatedAt))}</p></div><span class="company-stage-badge" data-stage="${escapeHtml(stage)}">${escapeHtml(stage)}</span></div><ol class="company-stepper" aria-label="公司阶段位置；仅标记已有记录的阶段">${steps.map((step, index) => `<li class="${step === stage ? 'is-current' : visited.has(step) ? 'is-recorded' : ''}"${step === stage ? ' aria-current="step"' : ''}><span>${index + 1}</span><b>${step}</b></li>`).join('')}</ol>${next ? `<div class="company-next"><span>最近待办</span>${progressDue(next.record)}<small>${escapeHtml(next.job.title)}</small></div>` : ''}${progressRow(first)}${others.length ? `<details class="company-details" data-company-details="progress" data-company-key="${escapeHtml(group.key)}"${open}><summary>其他 ${others.length} 个岗位 / 入口</summary>${others.map(progressRow).join('')}</details>` : ''}</article>`;
  }
  function renderProgress() {
    if (!state.data) return;
    const allGroups = groupCompanies(progressItems(), item => item.job.company);
    const stages = ['待投递', '已投递', '笔试', '面试', 'Offer', '已结束'];
    $('#progressStages').innerHTML = stages.map((stage, index) => `<button type="button" class="stage-overview" data-progress-filter="stage:${stage}" aria-pressed="false"><span class="stage-overview-label"><i>${index + 1}</i>${stage}</span><strong>${allGroups.filter(group => progressStage(group) === stage).length}<small>家</small></strong></button>`).join('');
    const query = ($('#progressSearch').value || '').trim().toLowerCase();
    const groups = allGroups.filter(group => {
      if (state.progressFilter.startsWith('stage:') && progressStage(group) !== state.progressFilter.slice(6)) return false;
      if (state.progressFilter === 'applied' && !group.items.some(item => isApplied(item.record))) return false;
      if (state.progressFilter === 'unapplied' && progressStage(group) !== '待投递') return false;
      if (state.progressFilter === 'followup' && !group.items.some(item => isFollowup(item.record))) return false;
      return !query || group.items.some(({ job, record }) => [job.company, job.title, record.note, record.nextAction, ...record.history.flatMap(event => [event.label, event.note])].join(' ').toLowerCase().includes(query));
    }).sort((a, b) => Number(b.items.some(item => isFollowup(item.record))) - Number(a.items.some(item => isFollowup(item.record))) || b.items.map(item => item.record.updatedAt).sort().at(-1).localeCompare(a.items.map(item => item.record.updatedAt).sort().at(-1)));
    const itemCount = groups.reduce((sum, group) => sum + group.items.length, 0);
    $('#progressList').innerHTML = paginate('progress', groups, `${itemCount} 条独立记录`).map(progressCard).join('');
    $('#emptyProgress').hidden = groups.length > 0;
    document.querySelectorAll('[data-progress-filter]').forEach(button => { const active = button.dataset.progressFilter === state.progressFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  }
  function setTab(tab, scroll = true) {
    if (!['jobs', 'radar', 'progress', 'profile'].includes(tab)) return;
    state.tab = tab;
    document.querySelectorAll('[data-tab]').forEach(button => { const active = button.dataset.tab === tab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); });
    ['jobs', 'radar', 'progress', 'profile'].forEach(name => { $(`#${name}Panel`).hidden = name !== tab; });
    if (tab === 'progress' && state.data) renderProgress();
    if (scroll) {
      const tabs = document.querySelector('.tabs');
      const selected = tabs.querySelector(`[data-tab="${tab}"]`);
      tabs.scrollTo({ left: selected.offsetLeft - tabs.offsetLeft - 3, behavior: 'smooth' });
      tabs.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  function render() { renderSummary(); renderJobs(); renderRadar(); renderProgress(); setTab(state.tab, false); }

  function openRecord(id) {
    const job = recordJob(id) || progressItems().find(item => item.job.id === id)?.job; if (!job) return;
    state.currentJobId = id;
    const record = state.records[id] ? normalizeProgressRecord(id, state.records[id]) : { status: '未开始', history: [] };
    $('#recordJobTitle').textContent = `${job.company} · ${job.title}`;
    $('#recordStatus').value = STATUSES.has(record.status) ? record.status : '未开始';
    $('#removeRecordBtn').hidden = !id.startsWith('custom-');
    $('#recordEventTitle').value = '';
    $('#recordOccurredAt').value = inputRecordTime();
    $('#recordNextDate').value = record.nextDate || '';
    $('#recordNextAction').value = record.nextAction || '';
    $('#recordNote').value = '';
    $('#recordHistory').innerHTML = record.history.length ? progressTimeline(record) : '<p class="timeline-empty">还没有记录，从这次进展开始。</p>';
    $('#recordHistoryCount').textContent = record.history.length;
    $('#recordDialog').showModal();
  }
  function persistProgressRecords(next) {
    const previous = state.records;
    state.records = next;
    if (saveRecords()) return true;
    state.records = previous;
    return false;
  }
  function refreshProgressViews() { updateRecordMetrics(); renderJobs(); renderProgress(); }
  function progressEvent(status, values) {
    return { id: `event-${crypto.randomUUID()}`, status, occurredAt: values.occurredAt, loggedAt: new Date().toISOString(), label: values.label || status, note: values.note || '', nextDate: values.nextDate || '', nextAction: values.nextAction || '', kind: 'event' };
  }
  function saveRecord(event) {
    event.preventDefault();
    const id = state.currentJobId; if (!id) return;
    const status = $('#recordStatus').value;
    if (!STATUSES.has(status)) return;
    const existing = state.records[id] ? normalizeProgressRecord(id, state.records[id]) : { history: [] };
    const job = recordJob(id, existing) || progressItems().find(item => item.job.id === id)?.job;
    if (!job) { toast('没有找到对应职位，请重新打开记录'); return; }
    const occurredAt = recordTime($('#recordOccurredAt').value);
    if (!occurredAt) { toast('请填写有效的进展发生时间'); return; }
    const nextDate = validRecordDate($('#recordNextDate').value);
    const nextAction = $('#recordNextAction').value.trim().slice(0, 120);
    const note = $('#recordNote').value.trim().slice(0, 500);
    const label = $('#recordEventTitle').value.trim().slice(0, 120) || (existing.status !== status ? `阶段更新：${status}` : existing.nextDate !== nextDate || existing.nextAction !== nextAction ? '跟进安排更新' : '补充进展');
    const entry = progressEvent(status, { occurredAt, label, note, nextDate, nextAction });
    const record = { ...existing, status, nextDate, nextAction, note: note || existing.note || '', updatedAt: entry.loggedAt, appliedAt: existing.appliedAt || (APPLIED_STATUSES.has(status) ? occurredAt : ''), jobSnapshot: jobSnapshot(job), history: [...existing.history, entry] };
    if (!persistProgressRecords({ ...state.records, [id]: record })) return;
    $('#recordDialog').close(); refreshProgressViews(); toast('进展已保存，历史记录已保留');
  }
  function markViewed(id) {
    if (state.records[id]) return;
    const job = jobById(id); if (!job) return;
    const now = new Date().toISOString();
    const entry = progressEvent('已查看', { occurredAt: now, label: '打开招聘官网', note: '已打开官方入口，尚未确认完成投递。' });
    const record = { status: '已查看', nextDate: '', nextAction: '', note: '', updatedAt: now, appliedAt: '', jobSnapshot: jobSnapshot(job), history: [entry] };
    if (persistProgressRecords({ ...state.records, [id]: record })) refreshProgressViews();
  }
  function exportRecords() {
    const records = Object.fromEntries(Object.entries(state.records).map(([id, record]) => [id, record && STATUSES.has(record.status) ? normalizeProgressRecord(id, record) : record]));
    const payload = { version: 2, exportedAt: new Date().toISOString(), records };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `ai-infra-投递记录-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); toast('投递记录已导出');
  }
  async function importRecords(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (![1, 2].includes(parsed.version) || !parsed.records || typeof parsed.records !== 'object' || Array.isArray(parsed.records)) throw new Error('格式不正确');
      const clean = {};
      const eventSignature = entry => JSON.stringify(['id', 'status', 'occurredAt', 'loggedAt', 'label', 'note', 'nextDate', 'nextAction', 'kind'].map(key => entry[key] ?? ''));
      for (const [id, record] of Object.entries(parsed.records)) {
        if (!record || !STATUSES.has(record.status) || ['__proto__', 'constructor', 'prototype'].includes(id)) continue;
        if (record.history !== undefined && (!Array.isArray(record.history) || record.history.some(entry => !entry || typeof entry !== 'object' || !STATUSES.has(entry.status)))) throw new Error('时间线格式不正确');
        const snapshot = record.jobSnapshot;
        const job = jobById(id);
        const normalized = normalizeProgressRecord(id, record);
        const incoming = { status: normalized.status, nextDate: normalized.nextDate, nextAction: normalized.nextAction, note: normalized.note, updatedAt: normalized.updatedAt, appliedAt: normalized.appliedAt, history: normalized.history, jobSnapshot: job ? jobSnapshot(job) : { id, company: typeof snapshot?.company === 'string' ? snapshot.company.slice(0, 80) : '历史记录（公司待确认）', title: typeof snapshot?.title === 'string' ? snapshot.title.slice(0, 120) : `未找到职位信息 · ${id}`, city: String(snapshot?.city || '').slice(0, 80), url: safeUrl(snapshot?.url), statusUrl: safeUrl(snapshot?.statusUrl || snapshot?.url) } };
        if (state.records[id] && STATUSES.has(state.records[id].status)) {
          const current = normalizeProgressRecord(id, state.records[id]);
          const history = [...current.history];
          const contents = new Set(history.map(eventSignature));
          for (const entry of incoming.history) {
            const signature = eventSignature(entry);
            if (contents.has(signature)) continue;
            const copy = history.some(item => item.id === entry.id) ? { ...entry, id: `${entry.id.slice(0, 110)}-import-${historyKey(signature)}` } : entry;
            if (!history.some(item => eventSignature(item) === eventSignature(copy))) history.push(copy);
            contents.add(signature);
          }
          const latest = incoming.updatedAt > current.updatedAt ? incoming : current;
          clean[id] = { ...latest, jobSnapshot: job ? jobSnapshot(job) : latest.jobSnapshot || incoming.jobSnapshot, appliedAt: [current.appliedAt, incoming.appliedAt].filter(Boolean).sort()[0] || '', history };
        } else clean[id] = incoming;
      }
      const count = Object.keys(clean).length;
      if (!count) { toast('文件中没有可导入的投递记录'); return; }
      if (!persistProgressRecords({ ...state.records, ...clean })) return;
      state.pages.progress = 1; refreshProgressViews(); toast(`已合并 ${count} 条岗位记录，保留已有时间线`);
    } catch { toast('导入失败：请使用本站导出的完整 JSON 文件'); }
    finally { event.target.value = ''; }
  }

  function saveCustomRecord(event) {
    event.preventDefault();
    const company = $('#customCompany').value.trim(), title = $('#customJobTitle').value.trim();
    if (!company || !title) return;
    const rawUrl = $('#customUrl').value.trim();
    if (rawUrl && safeUrl(rawUrl) === '#') { toast('请填写 https 招聘官网链接'); return; }
    const id = `custom-${crypto.randomUUID()}`;
    const status = $('#customStatus').value;
    if (!STATUSES.has(status)) return;
    const now = new Date().toISOString();
    const occurredAt = recordTime($('#customOccurredAt').value);
    if (!occurredAt) { toast('请填写有效的进展发生时间'); return; }
    const job = { id, company, title, city: $('#customCity').value.trim() || '城市待确认', url: rawUrl, statusUrl: rawUrl };
    const nextDate = validRecordDate($('#customNextDate').value), nextAction = $('#customNextAction').value.trim().slice(0, 120), note = $('#customNote').value.trim().slice(0, 500);
    const entry = progressEvent(status, { occurredAt, label: $('#customEventTitle').value.trim().slice(0, 120) || '建立投递记录', nextDate, nextAction, note });
    const record = { status, nextDate, nextAction, note, updatedAt: now, appliedAt: APPLIED_STATUSES.has(status) ? occurredAt : '', jobSnapshot: jobSnapshot(job), history: [entry] };
    if (!persistProgressRecords({ ...state.records, [id]: record })) return;
    state.pages.progress = 1; refreshProgressViews(); $('#customDialog').close(); $('#customForm').reset(); toast('投递记录已添加');
  }

  function openVaultDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(VAULT_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function readVault() {
    const db = await openVaultDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction('vault', 'readonly').objectStore('vault').get('profile');
      request.onsuccess = () => { resolve(request.result || null); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    });
  }
  async function writeVault(envelope) {
    const db = await openVaultDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('vault', 'readwrite');
      transaction.objectStore('vault').put(envelope, 'profile');
      transaction.oncomplete = () => { resolve(); db.close(); };
      transaction.onerror = () => { reject(transaction.error); db.close(); };
    });
  }
  function b64(bytes) {
    let value = '';
    for (let index = 0; index < bytes.length; index += 32768) value += String.fromCharCode(...bytes.subarray(index, index + 32768));
    return btoa(value);
  }
  function unb64(value) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
  async function deriveVaultKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 240000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptProfile(profile, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveVaultKey(password, salt);
    const data = new TextEncoder().encode(JSON.stringify(profile));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { version: 1, kdf: 'PBKDF2-SHA256-240000', cipher: 'AES-256-GCM', salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(cipher)) };
  }
  async function decryptProfile(envelope, password) {
    const salt = unb64(envelope.salt), iv = unb64(envelope.iv);
    const key = await deriveVaultKey(password, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, unb64(envelope.data));
    const profile = JSON.parse(new TextDecoder().decode(plain));
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('资料格式不正确');
    return profile;
  }
  function showProfile(profile) {
    for (const field of ['Name', 'Phone', 'Email', 'School', 'Graduation', 'City']) $(`#profile${field}`).value = profile[field.toLowerCase()] || (field === 'Graduation' ? '2027-06' : '');
    $('#profileResumeInfo').textContent = profile.resume?.name ? `已保存：${profile.resume.name}` : '尚未保存简历文件';
    $('#downloadResumeBtn').hidden = !profile.resume?.data;
    $('#profileLocked').hidden = true;
    $('#profileUnlocked').hidden = false;
  }
  function lockProfile() {
    state.profilePassword = null; state.profile = null;
    $('#profilePassword').value = ''; $('#profileResumeInput').value = '';
    $('#profileUnlocked').hidden = true; $('#profileLocked').hidden = false;
    refreshVaultState();
  }
  async function refreshVaultState() {
    try {
      const exists = Boolean(await readVault());
      $('#profileLockTitle').textContent = exists ? '解锁个人资料' : '新建个人资料保险箱';
      $('#profileLockHint').textContent = exists ? '输入原密码查看此设备上的资料。' : '首次使用请设置至少 10 位密码，资料会在此设备加密保存。';
      $('#unlockProfileBtn').textContent = exists ? '解锁资料' : '新建保险箱';
    } catch { $('#profileLockHint').textContent = '浏览器无法访问本地资料存储，请检查隐私设置。'; }
  }
  async function unlockProfile() {
    const password = $('#profilePassword').value;
    if (!password) { toast('请输入保险箱密码'); return; }
    try {
      const envelope = await readVault();
      if (!envelope && password.length < 10) { toast('新密码至少 10 位'); return; }
      const profile = envelope ? await decryptProfile(envelope, password) : { graduation: '2027-06' };
      state.profilePassword = password; state.profile = profile;
      $('#profilePassword').value = '';
      showProfile(profile);
      toast(envelope ? '资料已解锁' : '请填写资料并点击加密保存');
    } catch { toast('解锁失败：密码错误或本机存储不可用'); }
  }
  async function saveProfile() {
    if (!state.profilePassword) return;
    const profile = { ...state.profile };
    for (const field of ['Name', 'Phone', 'Email', 'School', 'Graduation', 'City']) profile[field.toLowerCase()] = $(`#profile${field}`).value.trim();
    const file = $('#profileResumeInput').files?.[0];
    if (file) {
      if (file.size > 8 * 1024 * 1024 || !/\.(pdf|docx?)$/i.test(file.name)) { toast('简历限 PDF / DOC / DOCX，最大 8 MB'); return; }
      profile.resume = { name: file.name, type: file.type || 'application/octet-stream', data: b64(new Uint8Array(await file.arrayBuffer())) };
    }
    try {
      const envelope = await encryptProfile(profile, state.profilePassword);
      await writeVault(envelope);
      state.profile = profile; $('#profileResumeInput').value = ''; showProfile(profile);
      toast('资料已在此设备加密保存');
    } catch { toast('保存失败：本机存储空间可能不足'); }
  }
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadResume() {
    const resume = state.profile?.resume;
    if (!resume?.data) return;
    downloadBlob(new Blob([unb64(resume.data)], { type: resume.type }), resume.name);
  }
  async function exportVault() {
    const envelope = await readVault();
    if (!envelope) { toast('请先加密保存资料'); return; }
    downloadBlob(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }), 'ai-infra-个人资料-加密备份.json');
    toast('加密备份已导出');
  }
  async function importVault(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const envelope = JSON.parse(await file.text());
      if (envelope.version !== 1 || envelope.kdf !== 'PBKDF2-SHA256-240000' || envelope.cipher !== 'AES-256-GCM' || !['salt', 'iv', 'data'].every(key => typeof envelope[key] === 'string' && envelope[key].length > 10)) throw new Error('格式不正确');
      const password = $('#profilePassword').value;
      if (!password) { toast('请先输入加密备份的原密码'); return; }
      await decryptProfile(envelope, password);
      if (await readVault() && !confirm('导入会替换此设备已有的个人资料，继续吗？')) return;
      await writeVault(envelope); lockProfile(); await refreshVaultState(); toast('加密备份已导入，请输入原密码解锁');
    } catch { toast('导入失败：请核对备份文件和原密码'); }
    finally { event.target.value = ''; }
  }

  document.addEventListener('click', event => {
    const page = event.target.closest('[data-page-view]'); if (page) { if (!page.disabled) changePage(page.dataset.pageView, Number(page.dataset.page)); return; }
    const go = event.target.closest('[data-go]'); if (go) { setTab(go.dataset.go); return; }
    const tab = event.target.closest('[data-tab]'); if (tab) { setTab(tab.dataset.tab); return; }
    const city = event.target.closest('[data-city]'); if (city) { state.city = city.dataset.city; state.pages.jobs = 1; renderJobs(); setCityFiltersOpen(false); $('#cityToggle').focus({ preventScroll: true }); return; }
    const mode = event.target.closest('[data-mode]'); if (mode) { state.mode = mode.dataset.mode; state.pages.jobs = 1; renderJobs(); return; }
    const apply = event.target.closest('[data-apply]'); if (apply) { state.apply = apply.dataset.apply; state.pages.jobs = 1; renderJobs(); return; }
    const progressFilter = event.target.closest('[data-progress-filter]'); if (progressFilter) { state.progressFilter = progressFilter.dataset.progressFilter; state.pages.progress = 1; renderProgress(); return; }
    const category = event.target.closest('[data-category]'); if (category) { state.radarCategory = category.dataset.category; state.pages.radar = 1; renderRadar(); return; }
    const radarCity = event.target.closest('[data-radar-city]'); if (radarCity) { state.radarCity = radarCity.dataset.radarCity; state.pages.radar = 1; renderRadar(); setRadarCitiesOpen(false); $('#radarCityToggle').focus({ preventScroll: true }); return; }
    const record = event.target.closest('[data-record]'); if (record) { openRecord(record.dataset.record); return; }
    const jobLink = event.target.closest('[data-openjob]'); if (jobLink) markViewed(jobLink.dataset.openjob);
  });
  document.addEventListener('change', event => {
    const page = event.target.closest('[data-page-select]');
    if (page) changePage(page.dataset.pageSelect, Number(page.value));
  });
  document.addEventListener('toggle', event => {
    const details = event.target;
    if (!details.matches?.('details[data-company-details]') || !details.isConnected) return;
    const expanded = state.expanded[details.dataset.companyDetails];
    if (!expanded) return;
    if (details.open) expanded.add(details.dataset.companyKey);
    else expanded.delete(details.dataset.companyKey);
  }, true);
  $('#cityToggle').addEventListener('click', () => setCityFiltersOpen($('#cityFilters').hidden));
  $('#radarCityToggle').addEventListener('click', () => setRadarCitiesOpen($('#radarCityFilters').hidden));
  $('#radarFilters').addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#radarCityFilters').hidden) { setRadarCitiesOpen(false); $('#radarCityToggle').focus({ preventScroll: true }); } });
  $('.filters').addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#cityFilters').hidden) { setCityFiltersOpen(false); $('#cityToggle').focus({ preventScroll: true }); } });
  $('#searchInput').addEventListener('input', event => { state.query = event.target.value; state.pages.jobs = 1; if (state.data) renderJobs(); });
  $('#radarSearch').addEventListener('input', event => { state.radarQuery = event.target.value; state.pages.radar = 1; if (state.data) renderRadar(); });
  $('#sortSelect').addEventListener('change', event => { state.sort = event.target.value; state.pages.jobs = 1; if (state.data) renderJobs(); });
  $('#reloadBtn').addEventListener('click', () => { fetchJobs().then(ok => { if (ok) toast('已加载最新本站数据'); }); });
  $('#recordForm').addEventListener('submit', saveRecord);
  $('#closeDialog').addEventListener('click', () => $('#recordDialog').close());
  $('#cancelDialog').addEventListener('click', () => $('#recordDialog').close());
  $('#removeRecordBtn').addEventListener('click', () => {
    const id = state.currentJobId;
    if (!id?.startsWith('custom-') || !confirm('移除这条自定义记录及其时间线？如需保留，请先导出备份。')) return;
    const next = { ...state.records }; delete next[id];
    if (!persistProgressRecords(next)) return;
    refreshProgressViews(); $('#recordDialog').close(); toast('记录已移除');
  });
  $('#exportBtn').addEventListener('click', exportRecords);
  $('#importInput').addEventListener('change', importRecords);
  $('#addRecordBtn').addEventListener('click', () => { if (!$('#customOccurredAt').value) $('#customOccurredAt').value = inputRecordTime(); $('#customDialog').showModal(); });
  $('#progressSearch').addEventListener('input', () => { state.pages.progress = 1; renderProgress(); });
  window.addEventListener('storage', event => { if (event.key === STORAGE_KEY || event.key === null) { state.records = loadRecords(); if (state.data) refreshProgressViews(); } });
  $('#customForm').addEventListener('submit', saveCustomRecord);
  $('#closeCustomDialog').addEventListener('click', () => $('#customDialog').close());
  $('#cancelCustomDialog').addEventListener('click', () => $('#customDialog').close());
  $('#unlockProfileBtn').addEventListener('click', unlockProfile);
  $('#profilePassword').addEventListener('keydown', event => { if (event.key === 'Enter') unlockProfile(); });
  $('#saveProfileBtn').addEventListener('click', saveProfile);
  $('#lockProfileBtn').addEventListener('click', lockProfile);
  $('#downloadResumeBtn').addEventListener('click', downloadResume);
  $('#exportVaultBtn').addEventListener('click', exportVault);
  $('#importVaultInput').addEventListener('change', importVault);
  refreshVaultState();
  fetchJobs();
})();
