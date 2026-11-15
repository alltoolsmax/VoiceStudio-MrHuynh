import type { CatalogueModel } from './model-catalogue-query';
import { performanceTiers, type PerformanceTier } from '@/hooks/use-performance-profile';
import { modelDiskShortfall } from './model-disk-space';

// Voice Studio - Mr.Huỳnh: VoxCPM2 (Apache-2.0) thay OmniVoice (trọng số cấm thương mại).
const VOXCPM2 = 'openbmb/VoxCPM2';
const WHISPER_BASE = 'Systran/faster-whisper-base';
const WHISPER_TURBO = 'deepdml/faster-whisper-large-v3-turbo-ct2';
const WHISPER_LARGE = 'Systran/faster-whisper-large-v3';
const MLX_WHISPER_LARGE = 'mlx-community/whisper-large-v3-mlx';
const SHERPA_TINY = 'csukuangfj/sherpa-onnx-whisper-tiny';
const SHERPA_PARAKEET = 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8';

export const performancePackRepos: Record<PerformanceTier, readonly string[]> = {
  // NLLB (CC-BY-NC) không còn nằm trong gói đề xuất vì cấm dùng thương mại.
  fast: [VOXCPM2, WHISPER_BASE, SHERPA_TINY],
  balanced: [VOXCPM2, WHISPER_TURBO, SHERPA_TINY, SHERPA_PARAKEET],
  quality: [VOXCPM2, WHISPER_LARGE, SHERPA_TINY, SHERPA_PARAKEET],
  max: [VOXCPM2, WHISPER_LARGE, SHERPA_TINY, SHERPA_PARAKEET],
};

const acceleratedVariants: Readonly<Record<string, string>> = {
  [WHISPER_LARGE]: MLX_WHISPER_LARGE,
};

export interface PerformanceModelPack {
  tier: PerformanceTier;
  models: CatalogueModel[];
  missing: CatalogueModel[];
  totalGb: number;
  downloadGb: number;
}

/** Resolve a pack against the target catalogue so unsupported host models never download. */
export function resolvePerformanceModelPack(
  models: CatalogueModel[],
  tier: PerformanceTier,
): PerformanceModelPack {
  const byRepo = new Map(models.map((model) => [model.repo_id, model]));
  const selected = performancePackRepos[tier]
    .map((repoId) => {
      const accelerated = byRepo.get(acceleratedVariants[repoId] ?? '');
      return accelerated?.supported ? accelerated : byRepo.get(repoId);
    })
    .filter((model): model is CatalogueModel => Boolean(model?.supported));
  const missing = selected.filter((model) => !model.installed);
  return {
    tier,
    models: selected,
    missing,
    totalGb: selected.reduce((total, model) => total + model.size_gb, 0),
    downloadGb: missing.reduce((total, model) => total + model.size_gb, 0),
  };
}

/**
 * The pack to preselect: the preferred tier when its download fits the model
 * disk, else the largest smaller tier that fits, else the smallest tier.
 * Unknown free space keeps the preferred tier.
 */
export function largestFittingTier(
  models: CatalogueModel[],
  preferred: PerformanceTier,
  freeGb: number | null | undefined,
  headroomGb: number | null | undefined,
): PerformanceTier {
  const candidates = performanceTiers.slice(0, performanceTiers.indexOf(preferred) + 1).reverse();
  return (
    candidates.find(
      (tier) =>
        !modelDiskShortfall(
          resolvePerformanceModelPack(models, tier).downloadGb,
          freeGb,
          headroomGb,
        ),
    ) ?? performanceTiers[0]
  );
}
