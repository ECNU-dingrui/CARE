# vendor

把平台交付的 `software-factory-runtime-sdk-0.4.1.tgz` 放到本目录，再在 `dsh-plugin/` 下执行：

```bash
npm install
```

`package.json` 已把它声明为本地文件依赖。若使用 GitHub Packages 版本，按 SDK README 的 `npm:` 别名方式安装，
并保持源码中的导入名 `@software-factory/runtime-sdk` 不变。
