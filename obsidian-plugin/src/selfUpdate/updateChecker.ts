// GitHub Releases の最新版を取得し、ローカルバージョンと比較する。
// Spec: docs/superpowers/specs/2026-09-04-self-update-design.md
import { httpGet } from "./http";
import type { ReleaseAsset, UpdateCheckResult } from "./types";

export const RELEASES_LATEST_URL =
  "https://api.github.com/repos/superlambkin/GijiObisdian/releases/latest";

const GH_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "GijiObsidian-Plugin",
};

/** タグの `v` プレフィックスを除去 */
export function stripVPrefix(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/** semver 厳密比較（a<b:負 / a>b:正 / 同等:0）。Major.Minor.Patch のみ */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface GithubLatestRelease {
  tag_name?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

export async function checkForUpdate(localVersion: string): Promise<UpdateCheckResult> {
  const res = await httpGet(RELEASES_LATEST_URL, GH_HEADERS);
  if (res.status === 404) throw new Error(`GitHub API 404: Release が見つかりません (${RELEASES_LATEST_URL})`);
  if (res.status === 403) throw new Error("GitHub API 403: レート制限です。1 時間後に再試行してください");
  if (!res.ok) throw new Error(`GitHub API error: HTTP ${res.status}`);
  const body = (await res.json()) as GithubLatestRelease;
  const tagName = body.tag_name ?? "";
  const assets: ReleaseAsset[] = (body.assets ?? [])
    .filter((a): a is { name: string; browser_download_url: string } =>
      typeof a.name === "string" && typeof a.browser_download_url === "string")
    .map((a) => ({ name: a.name, browser_download_url: a.browser_download_url }));
  return {
    updateAvailable: compareSemver(stripVPrefix(tagName), localVersion) > 0,
    tagName,
    assets,
  };
}
