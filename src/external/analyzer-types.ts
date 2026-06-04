import { z } from 'zod';

export const PROPAGATION_DIRECTIONS = ['forward', 'backward', 'both'] as const;

export const PropagationDirectionSchema = z.enum(PROPAGATION_DIRECTIONS);

export type PropagationDirection = z.infer<typeof PropagationDirectionSchema>;

export const ExternalEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.string(),
  propagation: PropagationDirectionSchema.default('forward'),
  weight: z.number().min(0).max(1).default(0.7),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ExternalEdge = z.infer<typeof ExternalEdgeSchema>;

export const AnchorMappingSchema = z.object({
  domainId: z.string(),
  filePaths: z.array(z.string()),
  symbolIds: z.array(z.string()).optional(),
  artifactId: z.string().optional(),
});

export type AnchorMapping = z.infer<typeof AnchorMappingSchema>;

export const ExternalInsightSchema = z.object({
  source: z.string(),
  sourceVersion: z.string().optional(),
  generatedAt: z.string().optional(),
  edges: z.array(ExternalEdgeSchema),
  anchorMapping: z.array(AnchorMappingSchema).optional(),
});

export type ExternalInsight = z.infer<typeof ExternalInsightSchema>;

export const InsightQuerySchema = z.object({
  projectRoot: z.string(),
  changedFiles: z.array(z.string()).optional(),
  changedSymbols: z.array(z.string()).optional(),
  artifactIds: z.array(z.string()).optional(),
  evidencePolicy: z
    .object({
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
});

export type InsightQuery = z.infer<typeof InsightQuerySchema>;

export interface InsightProvider {
  readonly name: string;
  provide(query: InsightQuery): Promise<ExternalInsight>;
}
