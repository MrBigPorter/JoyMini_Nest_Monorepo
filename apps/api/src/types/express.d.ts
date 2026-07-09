/**
 * Express.Multer.File 类型声明
 * @types/express 和 @types/multer 版本演进后，Express.Multer 命名空间不再自动包含。
 * 添加此声明以兼容项目中使用的 Express.Multer.File 类型。
 */
declare namespace Express {
  namespace Multer {
    interface File {
      /** Field name specified in the form */
      fieldname: string;
      /** Original name of the file on the client's machine */
      originalname: string;
      /** Encoding type of the file */
      encoding: string;
      /** Mime type of the file */
      mimetype: string;
      /** Size of the file in bytes */
      size: number;
      /** The folder to which the file has been saved (DiskStorage) */
      destination?: string;
      /** The name of the file within the destination (DiskStorage) */
      filename?: string;
      /** Full path of the uploaded file (DiskStorage) */
      path?: string;
      /** A Buffer of the entire file (MemoryStorage) */
      buffer: Buffer;
    }
  }
}
