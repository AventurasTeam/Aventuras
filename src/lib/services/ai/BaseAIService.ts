import { settings } from '$lib/stores/settings.svelte'
import { generateStructured } from './sdk/generate'

export abstract class BaseAIService {
  protected readonly serviceId: string

  constructor(serviceId: string) {
    this.serviceId = serviceId
  }

  protected get presetId(): string {
    return settings.getServicePresetId(this.serviceId)
  }

  protected async generate<T>(
    schema: import('zod').ZodType<T>,
    system: string,
    prompt: string,
    templateId: string,
  ): Promise<T> {
    return generateStructured(
      {
        presetId: this.presetId,
        schema,
        system,
        prompt,
      },
      templateId,
    )
  }
}
