const quote = (file) => JSON.stringify(file);

export default {
  "apps/**/*.{ts,tsx,js,jsx,mjs,cjs}": ["prettier --write", "eslint --fix"],

  "packages/**/*.{ts,tsx,js,jsx,mjs,cjs}": ["prettier --write", "eslint --fix"],

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
