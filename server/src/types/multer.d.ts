import 'multer';

/**
 * multer 1.4.x 的类型未透传 busboy 的 defParamCharset 选项（运行时已支持）。
 * 显式声明它，让各上传端点可以强制按 UTF-8 解码文件名——否则中文文件名会按
 * latin1 解码成乱码（busboy 默认值），写入标题/附件名时不可恢复。
 */
declare module 'multer' {
  interface Options {
    defParamCharset?: string;
  }
}
