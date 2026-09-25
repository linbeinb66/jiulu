import express from 'express';
import { setCookie, calendar, queryGiftIncomeByRoomId } from './api/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync, spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

/* ========== 服务端存储 ========== */
const STORAGE_FILE = join(__dirname, 'data', 'storage.json');

function readStorage() {
  try {
    if (!existsSync(STORAGE_FILE)) return {};
    return JSON.parse(readFileSync(STORAGE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeStorage(data) {
  const dir = join(__dirname, 'data');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * API: 获取存储数据
 * GET /api/storage
 * 可选 query: key - 获取指定 key 的数据，不传则返回全部
 */
app.get('/api/storage', (req, res) => {
  const data = readStorage();
  const key = req.query.key;
  if (key) {
    res.json({ success: true, data: data[key] ?? null });
  } else {
    res.json({ success: true, data });
  }
});

/**
 * API: 保存存储数据
 * POST /api/storage
 * body: { key, value } - 保存指定 key 的数据
 */
app.post('/api/storage', (req, res) => {
  const { key, value } = req.body;
  if (!key) {
    return res.json({ success: false, message: '缺少 key 参数' });
  }
  const data = readStorage();
  data[key] = value;
  writeStorage(data);
  res.json({ success: true });
});

/**
 * API: 删除存储数据
 * DELETE /api/storage/:key
 */
app.delete('/api/storage/:key', (req, res) => {
  const key = req.params.key;
  const data = readStorage();
  delete data[key];
  writeStorage(data);
  res.json({ success: true });
});

/**
 * 获取日期范围内的所有月份列表
 * @param {string} startDate - 开始日期，如 2026-07-01
 * @param {string} endDate - 结束日期，如 2026-09-25
 * @returns {string[]} 月份列表，如 ['2026-07', '2026-08', '2026-09']
 */
function getMonthsInRange(startDate, endDate) {
  const months = [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

/**
 * API: 查询主播流水
 * POST /api/query
 * body: { start_date, end_date, anchor_id, cookie }
 */
app.post('/api/query', async (req, res) => {
  const { start_date, end_date, anchor_id, cookie } = req.body;

  if (!start_date || !end_date || !anchor_id || !cookie) {
    return res.json({ success: false, message: '参数不完整' });
  }

  try {
    setCookie(cookie);

    // 1. 获取直播日历（遍历所有月份，合并去重）
    const months = getMonthsInRange(start_date, end_date);
    const allDays = [];
    for (const m of months) {
      try {
        const calendarRes = await calendar(m, start_date, end_date, anchor_id);
        if (calendarRes.status_code === 0) {
          const days = calendarRes.data?.series || [];
          allDays.push(...days);
        }
      } catch (err) {
        // 单个月份查询失败不影响整体
      }
    }

    // 按日期去重
    const seenDates = new Set();
    const uniqueDays = [];
    for (const d of allDays) {
      if (!seenDates.has(d.date)) {
        seenDates.add(d.date);
        uniqueDays.push(d);
      }
    }

    const liveDays = uniqueDays.filter(d => d.room_ids && d.room_ids.trim() !== '' && d.date >= start_date && d.date <= end_date);

    if (liveDays.length === 0) {
      return res.json({ success: true, data: { days: [], summary: { totalIncome: 0, totalStarGuardIncome: 0, totalOtherIncome: 0, totalIncreaseFans: 0 } } });
    }

    // 2. 逐日查询流水
    const result = [];
    let totalIncome = 0;
    let totalStarGuardIncome = 0;
    let totalOtherIncome = 0;
    let totalIncreaseFans = 0;

    for (const day of liveDays) {
      const roomIds = day.room_ids.split(',');

      for (const roomId of roomIds) {
        try {
          const incomeRes = await queryGiftIncomeByRoomId(roomId, anchor_id);

          if (incomeRes.status_code === 0) {
            const series = incomeRes.data?.series || [];

            // 累计汇总
            for (const item of series) {
              totalIncome += Number(item.income) || 0;
              totalStarGuardIncome += Number(item.star_guard_income) || 0;
              totalOtherIncome += Number(item.other_income) || 0;
              totalIncreaseFans += Number(item.increase_fans) || 0;
            }

            result.push({
              date: day.date,
              roomId,
              liveDuration: day.live_duration,
              liveCnt: day.live_cnt,
              series,
            });
          }
        } catch (err) {
          // 单个房间查询失败不影响整体
        }
      }
    }

    // 按日期排序
    result.sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      success: true,
      data: {
        days: result,
        summary: {
          totalIncome,
          totalStarGuardIncome,
          totalOtherIncome,
          totalIncreaseFans,
        },
      },
    });
  } catch (err) {
    res.json({ success: false, message: `请求异常: ${err.message}` });
  }
});

app.post('/api/query/stream', async (req, res) => {
  const { start_date, end_date, anchor_id, cookie } = req.body;

  if (!start_date || !end_date || !anchor_id || !cookie) {
    return res.json({ success: false, message: '参数不完整' });
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    setCookie(cookie);

    // 1. 获取直播日历（遍历所有月份，合并去重）
    send('progress', { current: 0, total: 1, message: '获取直播日历...' });

    const months = getMonthsInRange(start_date, end_date);
    const allDays = [];
    for (const m of months) {
      try {
        const calendarRes = await calendar(m, start_date, end_date, anchor_id);
        if (calendarRes.status_code === 0) {
          const days = calendarRes.data?.series || [];
          allDays.push(...days);
        }
      } catch (err) {
        // 单个月份查询失败不影响整体
      }
    }

    // 按日期去重
    const seenDates = new Set();
    const uniqueDays = [];
    for (const d of allDays) {
      if (!seenDates.has(d.date)) {
        seenDates.add(d.date);
        uniqueDays.push(d);
      }
    }

    const liveDays = uniqueDays.filter(d => d.room_ids && d.room_ids.trim() !== '' && d.date >= start_date && d.date <= end_date);

    if (liveDays.length === 0) {
      send('progress', { current: 1, total: 1, message: '无直播记录' });
      send('done', {});
      res.end();
      return;
    }

    // 计算总房间数用于进度
    const totalRooms = liveDays.reduce((sum, d) => sum + d.room_ids.split(',').length, 0);
    let completed = 0;

    // 2. 逐日逐房间查询流水
    for (const day of liveDays) {
      const roomIds = day.room_ids.split(',');

      for (const roomId of roomIds) {
        try {
          const incomeRes = await queryGiftIncomeByRoomId(roomId, anchor_id);
          completed++;

          if (incomeRes.status_code === 0) {
            const series = incomeRes.data?.series || [];
            send('day', {
              data: {
                date: day.date,
                roomId,
                liveDuration: day.live_duration,
                liveCnt: day.live_cnt,
                series,
              },
            });
          }

          send('progress', {
            current: completed,
            total: totalRooms,
            message: `查询中 ${completed}/${totalRooms}`,
          });
        } catch (err) {
          completed++;
          send('progress', {
            current: completed,
            total: totalRooms,
            message: `查询中 ${completed}/${totalRooms}`,
          });
        }
      }
    }

    send('done', {});
  } catch (err) {
    send('error', { message: `请求异常: ${err.message}` });
  }

  res.end();
});

/**
 * API: 生成日报 - 批量查询所有主播当日数据
 * POST /api/daily-report
 * body: { anchors: [{id, name}], cookie, date }
 */
app.post('/api/daily-report', async (req, res) => {
  const { anchors, cookie, date } = req.body;

  if (!anchors || !Array.isArray(anchors) || anchors.length === 0 || !cookie || !date) {
    return res.json({ success: false, message: '参数不完整' });
  }

  try {
    setCookie(cookie);

    // 解析日期，计算月份和日期范围（当天）
    const dayDate = new Date(date);
    const year = dayDate.getFullYear();
    const month = String(dayDate.getMonth() + 1).padStart(2, '0');
    const monthStr = `${year}-${month}`;
    const dateStr = `${year}-${month}-${String(dayDate.getDate()).padStart(2, '0')}`;
    // 日历查询范围设为前后3天以确保覆盖
    const rangeStart = new Date(dayDate);
    rangeStart.setDate(rangeStart.getDate() - 3);
    const rangeEnd = new Date(dayDate);
    rangeEnd.setDate(rangeEnd.getDate() + 3);
    const startStr = `${rangeStart.getFullYear()}-${String(rangeStart.getMonth()+1).padStart(2,'0')}-${String(rangeStart.getDate()).padStart(2,'0')}`;
    const endStr = `${rangeEnd.getFullYear()}-${String(rangeEnd.getMonth()+1).padStart(2,'0')}-${String(rangeEnd.getDate()).padStart(2,'0')}`;

    const report = [];

    for (const anchor of anchors) {
      const anchorResult = {
        id: anchor.id,
        name: anchor.name || anchor.id,
        date: dateStr,
        liveDuration: 0,
        totalIncome: 0,
        totalStarGuardIncome: 0,
        totalOtherIncome: 0,
        totalIncreaseFans: 0,
        roomCount: 0,
        hasLive: false,
        members: [], // 各子主播(成员)的汇总数据
      };

      try {
        const calendarRes = await calendar(monthStr, startStr, endStr, anchor.id);

        if (calendarRes.status_code !== 0) {
          anchorResult.error = `获取日历失败: ${calendarRes.message}`;
          report.push(anchorResult);
          continue;
        }

        const days = calendarRes.data?.series || [];
        // 找到当天的直播记录
        const todayDays = days.filter(d => d.date === dateStr && d.room_ids && d.room_ids.trim() !== '');

        if (todayDays.length === 0) {
          report.push(anchorResult);
          continue;
        }

        anchorResult.hasLive = true;

        // 按 user_id 聚合子主播数据
        const memberMap = {};

        for (const day of todayDays) {
          const roomIds = day.room_ids.split(',');
          anchorResult.liveDuration += Number(day.live_duration) || 0;

          for (const roomId of roomIds) {
            try {
              const incomeRes = await queryGiftIncomeByRoomId(roomId, anchor.id);

              if (incomeRes.status_code === 0) {
                const series = incomeRes.data?.series || [];
                anchorResult.roomCount++;

                for (const item of series) {
                  const income = Number(item.income) || 0;
                  const starGuard = Number(item.star_guard_income) || 0;
                  const other = Number(item.other_income) || 0;
                  const fans = Number(item.increase_fans) || 0;

                  anchorResult.totalIncome += income;
                  anchorResult.totalStarGuardIncome += starGuard;
                  anchorResult.totalOtherIncome += other;
                  anchorResult.totalIncreaseFans += fans;

                  // 按子主播聚合
                  const key = item.user_id || item.nickname || '_unknown';
                  if (!memberMap[key]) {
                    memberMap[key] = {
                      user_id: item.user_id || '',
                      nickname: item.nickname || '',
                      avatar: item.avatar || '',
                      income: 0,
                      star_guard_income: 0,
                      other_income: 0,
                      increase_fans: 0,
                    };
                  }
                  memberMap[key].income += income;
                  memberMap[key].star_guard_income += starGuard;
                  memberMap[key].other_income += other;
                  memberMap[key].increase_fans += fans;
                }
              }
            } catch (err) {
              // 单个房间查询失败不影响整体
            }
          }
        }

        anchorResult.members = Object.values(memberMap);
      } catch (err) {
        anchorResult.error = `查询异常: ${err.message}`;
      }

      report.push(anchorResult);
    }

    // 汇总
    const summary = {
      totalIncome: report.reduce((s, a) => s + a.totalIncome, 0),
      totalStarGuardIncome: report.reduce((s, a) => s + a.totalStarGuardIncome, 0),
      totalOtherIncome: report.reduce((s, a) => s + a.totalOtherIncome, 0),
      totalIncreaseFans: report.reduce((s, a) => s + a.totalIncreaseFans, 0),
      liveCount: report.filter(a => a.hasLive).length,
      totalAnchors: report.length,
    };

    res.json({ success: true, data: { report, summary, date: dateStr } });
  } catch (err) {
    res.json({ success: false, message: `请求异常: ${err.message}` });
  }
});

/**
 * API: 查询主播当日流水汇总
 * GET /api/daily-income?anchor_id=xxx
 * 从 storage 中读取 cookie，查询该主播当日所有房间的流水并合并返回
 */
app.get('/api/daily-income', async (req, res) => {
  const { anchor_id, date } = req.query;

  if (!anchor_id) {
    return res.json({ success: false, message: '缺少 anchor_id 参数' });
  }

  try {
    const storage = readStorage();
    const cookie = storage.anchor_query_form?.cookie;

    if (!cookie) {
      return res.json({ success: false, message: '未找到 cookie 配置，请先在页面设置 cookie' });
    }

    setCookie(cookie);

    // 计算日期：优先使用传入的 date 参数，否则使用当日日期
    let dateStr, monthStr;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      dateStr = date;
      monthStr = date.substring(0, 7);
    } else {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      monthStr = `${year}-${month}`;
      dateStr = `${year}-${month}-${day}`;
    }

    // 日历查询范围设为前后3天以确保覆盖
    const targetDate = new Date(dateStr + 'T00:00:00');
    const rangeStart = new Date(targetDate);
    rangeStart.setDate(rangeStart.getDate() - 3);
    const rangeEnd = new Date(targetDate);
    rangeEnd.setDate(rangeEnd.getDate() + 3);
    const startStr = `${rangeStart.getFullYear()}-${String(rangeStart.getMonth() + 1).padStart(2, '0')}-${String(rangeStart.getDate()).padStart(2, '0')}`;
    const endStr = `${rangeEnd.getFullYear()}-${String(rangeEnd.getMonth() + 1).padStart(2, '0')}-${String(rangeEnd.getDate()).padStart(2, '0')}`;

    // 1. 获取直播日历
    const calendarRes = await calendar(monthStr, startStr, endStr, anchor_id);

    if (calendarRes.status_code !== 0) {
      return res.json({ success: false, message: `获取日历失败: ${calendarRes.message}` });
    }

    const days = calendarRes.data?.series || [];
    const todayDays = days.filter(d => d.date === dateStr && d.room_ids && d.room_ids.trim() !== '');

    if (todayDays.length === 0) {
      return res.json({
        success: true,
        data: {
          anchor_id,
          date: dateStr,
          hasLive: false,
          totalIncome: 0,
          totalStarGuardIncome: 0,
          totalOtherIncome: 0,
          totalIncreaseFans: 0,
          rooms: [],
        },
      });
    }

    // 2. 逐房间查询流水并合并
    let totalIncome = 0;
    let totalStarGuardIncome = 0;
    let totalOtherIncome = 0;
    let totalIncreaseFans = 0;
    let totalLiveDuration = 0;
    const rooms = [];

    for (const day of todayDays) {
      const roomIds = day.room_ids.split(',');
      totalLiveDuration += Number(day.live_duration) || 0;

      for (const roomId of roomIds) {
        try {
          const incomeRes = await queryGiftIncomeByRoomId(roomId, anchor_id);

          if (incomeRes.status_code === 0) {
            const series = incomeRes.data?.series || [];

            for (const item of series) {
              totalIncome += Number(item.income) || 0;
              totalStarGuardIncome += Number(item.star_guard_income) || 0;
              totalOtherIncome += Number(item.other_income) || 0;
              totalIncreaseFans += Number(item.increase_fans) || 0;
            }

            rooms.push({
              roomId,
              liveDuration: day.live_duration,
              series,
            });
          }
        } catch (err) {
          // 单个房间查询失败不影响整体
        }
      }
    }

    res.json({
      success: true,
      data: {
        anchor_id,
        date: dateStr,
        hasLive: true,
        liveDuration: totalLiveDuration,
        totalIncome,
        totalStarGuardIncome,
        totalOtherIncome,
        totalIncreaseFans,
        rooms,
      },
    });
  } catch (err) {
    res.json({ success: false, message: `请求异常: ${err.message}` });
  }
});

/* ========== 管理员 API ========== */

/**
 * API: 获取系统信息
 * GET /api/admin/info
 */
app.get('/api/admin/info', (req, res) => {
  try {
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: __dirname, encoding: 'utf-8' }).trim();
    const lastCommit = execSync('git log -1 --oneline', { cwd: __dirname, encoding: 'utf-8' }).trim();
    const lastUpdateTime = execSync('git log -1 --format="%ci"', { cwd: __dirname, encoding: 'utf-8' }).trim();
    const status = execSync('git status --short', { cwd: __dirname, encoding: 'utf-8' }).trim();
    res.json({
      success: true,
      data: {
        branch: currentBranch,
        lastCommit,
        lastUpdateTime,
        status: status || 'clean',
        uptime: process.uptime(),
        pid: process.pid,
        nodeVersion: process.version,
      },
    });
  } catch (err) {
    res.json({ success: false, message: `获取信息失败: ${err.message}` });
  }
});

/**
 * API: Git Pull 更新代码
 * POST /api/admin/pull
 */
app.post('/api/admin/pull', (req, res) => {
  try {
    const output = execSync('git pull -X theirs', { cwd: __dirname, encoding: 'utf-8', timeout: 60000 });
    res.json({ success: true, data: { output: output.trim() } });
  } catch (err) {
    res.json({ success: false, message: `Git pull 失败: ${err.message}` });
  }
});

/**
 * 自重启：spawn 新进程后退出当前进程
 */
function restartSelf() {
  const child = spawn(process.argv[0], [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
  process.exit(0);
}

/**
 * API: 热更新（重启服务）
 * POST /api/admin/restart
 */
app.post('/api/admin/restart', (req, res) => {
  res.json({ success: true, message: '服务即将重启...' });
  setTimeout(() => {
    restartSelf();
  }, 500);
});

/**
 * API: 一键更新（git pull + 重启）
 * POST /api/admin/update
 */
app.post('/api/admin/update', (req, res) => {
  try {
    const output = execSync('git pull -X theirs', { cwd: __dirname, encoding: 'utf-8', timeout: 60000 });
    res.json({ success: true, message: '更新成功，服务即将重启...', data: { output: output.trim() } });
    setTimeout(() => {
      restartSelf();
    }, 500);
  } catch (err) {
    res.json({ success: false, message: `更新失败: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 服务器已启动: http://localhost:${PORT}`);
});