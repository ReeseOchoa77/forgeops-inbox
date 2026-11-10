/** Display labels for Intelligence Registry type/status — shared by UI + tests. */

export function intelligenceTypeLabel(type: string): string {
  switch (type) {
    case 'AI_LLM':
      return 'AI / LLM'
    case 'DETERMINISTIC':
      return 'Deterministic'
    case 'HYBRID':
      return 'Hybrid'
    case 'ML_MODEL':
      return 'ML Model'
    case 'AGENT':
      return 'Agent'
    default:
      return type
  }
}

export function intelligenceStatusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

export function instructionsTabLabel(type: string): string {
  const showInstructions = type === 'AI_LLM' || type === 'HYBRID' || type === 'AGENT'
  const showRules = type === 'DETERMINISTIC' || type === 'HYBRID'
  if (showInstructions && showRules) return 'Instructions & Rules'
  if (showInstructions) return 'Instructions'
  return 'Rules'
}

export function showInstructionsSection(type: string): boolean {
  return type === 'AI_LLM' || type === 'HYBRID' || type === 'AGENT'
}

export function showRulesSection(type: string): boolean {
  return type === 'DETERMINISTIC' || type === 'HYBRID'
}

/** Overview cards map registry DTOs generically — never hard-code component ids. */
export function mapIntelligenceCards<T extends { id: string; name: string }>(
  components: T[]
): T[] {
  return components
}
