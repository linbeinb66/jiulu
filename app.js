import express from 'express';
import { setCookie, calendar, queryGiftIncomeByRoomId } from './api/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

/**
 * API: 查询主播流水
 * POST /api/query
 * body: { month, start_date, end_date, anchor_id, cookie }
 */
app.post('/api/query', async (req, res) => {
  const { month, start_date, end_date, anchor_id, cookie } = req.body;

  if (!month || !start_date || !end_date || !anchor_id || !cookie) {
    return res.json({ success: false, message: '参数不完整' });
  }

  try {
    setCookie(cookie);

    // 1. 获取直播日历
    const calendarRes = await calendar(month, start_date, end_date, anchor_id);

    if (calendarRes.status_code !== 0) {
      return res.json({ success: false, message: `获取日历失败: ${calendarRes.message}` });
    }

    const days = calendarRes.data?.series || [];
    const liveDays = days.filter(d => d.room_ids && d.room_ids.trim() !== '');

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
  const { month, start_date, end_date, anchor_id, cookie } = req.body;

  if (!month || !start_date || !end_date || !anchor_id || !cookie) {
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

    // 1. 获取直播日历
    send('progress', { current: 0, total: 1, message: '获取直播日历...' });

    const calendarRes = await calendar(month, start_date, end_date, anchor_id);

    if (calendarRes.status_code !== 0) {
      send('error', { message: `获取日历失败: ${calendarRes.message}` });
      res.end();
      return;
    }

    const days = calendarRes.data?.series || [];
    const liveDays = days.filter(d => d.room_ids && d.room_ids.trim() !== '');

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

        // 按 aweme_display_id 聚合子主播数据
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
                  const key = item.aweme_display_id || item.nickname || '_unknown';
                  if (!memberMap[key]) {
                    memberMap[key] = {
                      aweme_display_id: item.aweme_display_id || '',
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

app.listen(PORT, () => {
  console.log(`🚀 服务器已启动: http://localhost:${PORT}`);
});