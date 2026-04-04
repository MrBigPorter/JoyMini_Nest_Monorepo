export interface BuildInfoViewModel {
  label: string;
  shortSha: string | null;
  fullSha: string | null;
  tooltip: string;
}

function formatUtc(isoLike: string): string | null {
  const date = new Date(isoLike);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

export function buildBuildInfoViewModel(
  deployedAt?: string,
  gitSha?: string,
): BuildInfoViewModel | null {
  const normalizedDeployedAt = deployedAt?.trim();
  const normalizedGitSha = gitSha?.trim();

  if (!normalizedDeployedAt && !normalizedGitSha) {
    return null;
  }

  const isLocalBuild =
    normalizedDeployedAt === 'local-dev' || normalizedGitSha === 'local-dev';

  const label = isLocalBuild
    ? 'Local build'
    : normalizedDeployedAt
      ? (formatUtc(normalizedDeployedAt) ?? normalizedDeployedAt)
      : 'Build time unavailable';

  const fullSha =
    normalizedGitSha && normalizedGitSha !== 'local-dev'
      ? normalizedGitSha
      : null;
  const shortSha = fullSha ? fullSha.slice(0, 7) : null;

  const tooltipParts = [label];
  if (fullSha) {
    tooltipParts.push(`commit ${fullSha}`);
  }

  return {
    label,
    shortSha,
    fullSha,
    tooltip: tooltipParts.join(' · '),
  };
}
