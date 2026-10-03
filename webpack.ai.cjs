const path = require("node:path");
module.exports = {
  mode: "production",
  entry: "./extension/ai-service.js",
  target: "webworker",
  devtool: false,
  output: { path: path.resolve(__dirname, "src/background"), filename: "aiService.bundle.js" },
  performance: { hints: false },
};
