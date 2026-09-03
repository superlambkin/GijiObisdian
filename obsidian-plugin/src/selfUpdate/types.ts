/** GitHub Release のアセット（配布ファイル） */
export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** 更新チェック結果 */
export interface UpdateCheckResult {
  updateAvailable: boolean;
  tagName: string;
  assets: ReleaseAsset[];
}
