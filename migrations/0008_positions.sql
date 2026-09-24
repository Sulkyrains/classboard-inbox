-- 班委职位列：班长/团支书是主要班委，权限高于其他委员（规则见 src/shared/roles.ts）。
-- 具体职位不写在这里：它包含真实姓名与学号，按「名单不进 Git」的约定，
-- 改由本地 gitignore 的名单文件写入：node scripts/accounts.mjs --positions work/positions.json --remote
ALTER TABLE users ADD COLUMN position TEXT;
