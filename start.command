#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print '未找到 Node.js。请先安装 Node.js，再运行此文件。'
  read
  exit 1
fi
npm start
