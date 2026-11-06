import type { AppState } from './types';
export const isDesktop = !!window.accountor;
export async function call<T = any>(channel: string, ...args: any[]): Promise<T> {
  if (!window.accountor) throw new Error('请通过 npm run dev 启动桌面应用，此浏览器窗口不具备本地文件与终端权限。');
  return window.accountor.invoke<T>(channel, ...args);
}
export const initialState: AppState = { deletedWorkspaces: [], workspaces: [], accounts: [], sessions: [], selectedWorkspace: '', drafts: {}, operations: [], settings: { theme: 'system', background: '', opacity: 30, fontSize: 14, shell: '', claudePath: '' } };
export const statusLabel = (status: string) => ({ starting: '启动中', running: '进程运行中', busy: '工作中', idle: '等待输入', exited: '已结束', failed: '启动失败', interrupted: '可恢复', valid: '登录有效', login: '需要登录', unknown: '状态未知' }[status] || status);
export const nameOf = (p: string) => p.split(/[\\/]/).pop() || p;
export const timeOf = (t?: number) => t ? new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '尚未采集';
