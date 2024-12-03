const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");

module.exports = {
  entry: path.join(__dirname, "src", "index.jsx"),
  output: {
    path: path.resolve(__dirname, "dist"),
  },

  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: [
              "@babel/preset-env",
              ["@babel/preset-react", { runtime: "automatic" }],
            ],
          },
        },
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(png|jpg|gif|svg)$/, // Match image files
        use: {
          loader: "file-loader",
          options: {
            name: "[name].[hash].[ext]", // Output file naming
            outputPath: "assets",
          },
        },
      },
    ],
  },
  resolve: {
    extensions: [".js", ".jsx"],
    alias: {
      browser: false,
      fs: false,
      path: require.resolve("path-browserify"),
      buffer: require.resolve("buffer"),
      //   vm: false,
      //   process: require.resolve("process/browser"),
      //   stream: require.resolve("stream-browserify"),
      crypto: false,
    },
  },
  plugins: [
    new HtmlWebpackPlugin({ template: "./public/index.html" }),
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
  ],
  devServer: {
    hot: true,
    port: 3030,
    open: true,
  },
  mode: "development", // Mode: development or production
};
