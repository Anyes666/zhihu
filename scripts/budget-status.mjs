// Local owner-only command. Do not expose snapshot() through an unauthenticated HTTP route.
import { budget } from "../lib/budget.mjs";
try { console.log(JSON.stringify(budget.snapshot(), null, 2)); }
catch { console.error("预算账本不可读，实时请求保持关闭。请检查本机数据库路径、权限和运行时；不要删除账本来排错。"); process.exitCode = 1; }
finally { budget.close(); }
