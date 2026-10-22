export type FsRepoErrorCode =
  | 'PATH_OUTSIDE_DATA_DIR'
  | 'INVALID_PROJECT_ID'
  | 'INVALID_FILENAME'
  | 'INVALID_RELATIVE_PATH'
  | 'SYMLINK_NOT_ALLOWED'
  | 'DOCUMENT_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'NOT_UTF8';

export class FsRepoError extends Error {
  override readonly name = 'FsRepoError';
  constructor(
    readonly code: FsRepoErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class PathOutsideDataDirError extends FsRepoError {
  constructor(attempted: string) {
    super('PATH_OUTSIDE_DATA_DIR', `Path escapes data dir: ${attempted}`);
  }
}

export class InvalidProjectIdError extends FsRepoError {
  constructor(value: string) {
    super('INVALID_PROJECT_ID', `Invalid project id: ${JSON.stringify(value)}`);
  }
}

export class InvalidFilenameError extends FsRepoError {
  constructor(value: string) {
    super('INVALID_FILENAME', `Invalid filename: ${JSON.stringify(value)}`);
  }
}

export class InvalidRelativePathError extends FsRepoError {
  constructor(value: string) {
    super('INVALID_RELATIVE_PATH', `Invalid relative path: ${JSON.stringify(value)}`);
  }
}

export class SymlinkNotAllowedError extends FsRepoError {
  constructor(value: string) {
    super('SYMLINK_NOT_ALLOWED', `Symlinks not allowed under data dir: ${value}`);
  }
}

export class DocumentNotFoundError extends FsRepoError {
  constructor(value: string) {
    super('DOCUMENT_NOT_FOUND', `Document not found: ${value}`);
  }
}

export class ProjectNotFoundError extends FsRepoError {
  constructor(value: string) {
    super('PROJECT_NOT_FOUND', `Project not found: ${value}`);
  }
}

export class NotUtf8Error extends FsRepoError {
  constructor(value: string) {
    super('NOT_UTF8', `Not valid UTF-8 text: ${value}`);
  }
}
