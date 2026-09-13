import axios from 'axios';

let request = axios.create({
  baseURL: 'https://union.bytedance.com',
  headers: {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
    'cache-control': 'no-cache',
    'client-id': 'ark_api_tinker_proxy',
    priority: 'u=1, i',
    'x-appid': '3000',
    'x-appid-gray': '1',
    'x-requested-with': 'XMLHttpRequest',
    'x-use-bpsc': '1',
  },
});

/**
 * 设置请求的 cookie
 * @param {string} cookie - cookie 字符串
 */
export function setCookie(cookie) {
  request = axios.create({
    baseURL: 'https://union.bytedance.com',
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
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
}

/**
 * 查询房间礼物收入
 * @param {string} room_id - 房间ID
 * @param {string} anchor_id - 主播ID
 */
export async function queryGiftIncomeByRoomId(room_id, anchor_id) {
  const res = await request.get('/ark_api_tinker_proxy/lego/native/webcast_api/data/room/query_gift_income_by_room_id', {
    params: { room_id, anchor_id },
  });
  return res.data;
}

/**
 * 查询主播直播日历
 * @param {string} month - 月份，如 2026-09
 * @param {string} start_date - 开始日期，如 2026-08-30
 * @param {string} end_date - 结束日期，如 2026-10-03
 * @param {string} anchor_id - 主播ID
 */
export async function calendar(month, start_date, end_date, anchor_id) {
  const res = await request.get('/ark_api_tinker_proxy/lego/native/webcast_api/anchor/live/calendar', {
    params: { month, start_date, end_date, anchor_id },
  });
  return res.data;
}

export default request;