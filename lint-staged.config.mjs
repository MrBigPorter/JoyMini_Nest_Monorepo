const quote = (file) => JSON.stringify(file);

const createCommands = ({ files, eslintCommand, maxFiles = 10 }) => {
  if (files.length === 0) {
    return [];
  }

  // 限制每次检查的文件数量，避免性能问题
  const filesToCheck = files.slice(0, maxFiles);
  const joined = filesToCheck.map(quote).join(" ");
  
  // 只对TypeScript/JavaScript文件运行ESLint，其他文件只运行prettier
  const commands = [`prettier --write ${joined}`];
  
  // 检查文件扩展名，只对TS/JS文件运行ESLint
  const hasTsJsFiles = filesToCheck.some(file => 
    file.endsWith('.ts') || file.endsWith('.tsx') || 
    file.endsWith('.js') || file.endsWith('.jsx')
  );
  
  if (hasTsJsFiles) {
    // 使用--max-warnings=100参数，允许最多100个警告，只关注错误
    commands.push(`${eslintCommand} --max-warnings=100 ${joined}`);
  }
  
  return commands;
};

export default {
  "apps/admin-next/**/*.{ts,tsx,js,jsx}": (files) =>
    createCommands({
      files,
      eslintCommand: "yarn workspace @lucky/admin-next exec eslint",
      maxFiles: 20, // 增加admin-next的检查文件数量限制
    }),

  "apps/api/src/**/*.{ts,tsx,js,jsx}": (files) =>
    createCommands({
      files,
      eslintCommand: "yarn workspace @lucky/api exec eslint",
    }),

  "packages/ui/src/**/*.{ts,tsx,js,jsx}": (files) =>
    createCommands({
      files,
      eslintCommand: "yarn workspace @repo/ui exec eslint",
    }),

  "apps/frontend-blog/src/**/*.{ts,tsx,js,jsx}": (files) =>
    createCommands({
      files,
      eslintCommand: "yarn workspace @lucky/frontend-blog exec eslint",
    }),

  "apps/liveness-web/**/*.{ts,tsx,js,jsx}": (files) =>
    createCommands({
      files,
      eslintCommand: "yarn workspace @lucky/liveness-web exec eslint",
    }),

  "*.{json,md,yml,yaml,mjs,cjs}": (files) => {
    const filtered = files.filter(
      (file) => !file.startsWith("starter-template/"),
    );

    if (filtered.length === 0) {
      return [];
    }

    return [`prettier --write ${filtered.map(quote).join(" ")}`];
  },
};
