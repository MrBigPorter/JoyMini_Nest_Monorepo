const quote = (file) => JSON.stringify(file);

const createCommands = ({ files, eslintCommand }) => {
  if (files.length === 0) {
    return [];
  }

  const joined = files.map(quote).join(" ");
  return [`prettier --write ${joined}`, `${eslintCommand} ${joined}`];
};

export default {
  "apps/admin-next/**/*.{ts,tsx,js,jsx}": (files) =>
    createCommands({
      files,
      eslintCommand: "yarn workspace @lucky/admin-next exec eslint --fix",
    }),

  "apps/api/src/**/*.{ts,tsx,js,jsx}": (files) =>
    createCommands({
      files,
      eslintCommand: "yarn workspace @lucky/api exec eslint --fix",
    }),

  "packages/ui/src/**/*.{ts,tsx,js,jsx}": (files) =>
    createCommands({
      files,
      eslintCommand: "yarn workspace @repo/ui exec eslint --fix",
    }),

  "apps/liveness-web/**/*.{ts,tsx,js,jsx}": (files) =>
    createCommands({
      files,
      eslintCommand: "yarn workspace @lucky/liveness-web exec eslint --fix",
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
