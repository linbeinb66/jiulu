import axios from 'axios';

const cookie = "d_ticket=16d674325520cda6a7dd6665c768845d9d8fa; n_mh=0nEoaTepFk6L9nK9QzgL9yXCByYvoGIqaH2-J7koh78; has_biz_token=false; kura_cloud_uid=5a011f4f55c973e7fd4cfc53312074a6; xgplayer_device_id=73143634223; is_staff_user=false; passport_csrf_token=51db9d2d607454379d2c9fc16a4e265b; passport_csrf_token_default=51db9d2d607454379d2c9fc16a4e265b; sid_tt=6edd28addf29afcd856e405720bb2b92; sessionid=6edd28addf29afcd856e405720bb2b92; sessionid_ss=6edd28addf29afcd856e405720bb2b92; uid_tt=14c96c7b82a342f0899460ab648ed534; uid_tt_ss=14c96c7b82a342f0899460ab648ed534; ttwid=1%7CWktsnhMI-fI10GY86di5McxbpaL3MM5rRQi4p2VLtL0%7C1790315328%7C80d345af842f389ef3c816e38572ee60f88b1717c2bfaa676ed3c008e94dbccc; tt_scid=8ubiqvFo3q3Lal17QEWv7qtNREheTQDX.WA31b2lTvj-N1WRjt1TFeU0-87rGQpq7db2";

const request = axios.create({
  baseURL: 'https://union.bytedance.com',
  headers: {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    'client-id': 'ark_api_tinker_proxy',
    priority: 'u=1, i',
    'x-appid': '3000',
    'x-appid-gray': '1',
    'x-requested-with': 'XMLHttpRequest',
    'x-use-bpsc': '1',
    cookie,
  },
});

const anchor_id = '1488052147722268';

// 测试1: 查询昨日单天 (month=2026-09, start_date=2026-09-24, end_date=2026-09-24)
console.log('\n=== 测试1: month=2026-09, start_date=2026-09-24, end_date=2026-09-24 ===');
try {
  const res1 = await request.get('/ark_api_tinker_proxy/lego/native/webcast_api/anchor/live/calendar', {
    params: { month: '2026-09', start_date: '2026-09-24', end_date: '2026-09-24', anchor_id },
  });
  const days1 = res1.data?.data?.series || [];
  console.log('返回天数:', days1.length);
  console.log('所有日期:', days1.map(d => d.date).join(', '));
  const liveDays1 = days1.filter(d => d.room_ids && d.room_ids.trim() !== '');
  console.log('有直播的日期:', liveDays1.map(d => `${d.date} (room_ids: ${d.room_ids})`).join('\n'));
} catch (e) {
  console.log('请求失败:', e.message);
}

// 测试2: 查询本月范围 (month=2026-09, start_date=2026-09-01, end_date=2026-09-25)
console.log('\n=== 测试2: month=2026-09, start_date=2026-09-01, end_date=2026-09-25 ===');
try {
  const res2 = await request.get('/ark_api_tinker_proxy/lego/native/webcast_api/anchor/live/calendar', {
    params: { month: '2026-09', start_date: '2026-09-01', end_date: '2026-09-25', anchor_id },
  });
  const days2 = res2.data?.data?.series || [];
  console.log('返回天数:', days2.length);
  console.log('所有日期:', days2.map(d => d.date).join(', '));
  const liveDays2 = days2.filter(d => d.room_ids && d.room_ids.trim() !== '');
  console.log('有直播的日期:', liveDays2.map(d => `${d.date} (room_ids: ${d.room_ids})`).join('\n'));
} catch (e) {
  console.log('请求失败:', e.message);
}

// 测试3: 不传 start_date/end_date, 只传 month
console.log('\n=== 测试3: month=2026-09 (不传start_date/end_date) ===');
try {
  const res3 = await request.get('/ark_api_tinker_proxy/lego/native/webcast_api/anchor/live/calendar', {
    params: { month: '2026-09', anchor_id },
  });
  const days3 = res3.data?.data?.series || [];
  console.log('返回天数:', days3.length);
  console.log('所有日期:', days3.map(d => d.date).join(', '));
} catch (e) {
  console.log('请求失败:', e.message);
}