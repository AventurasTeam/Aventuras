import { invoke } from '@tauri-apps/api/core'
import { resolveSaveTarget } from './exportTarget'
import type { EmbeddedImageMeta } from '$lib/types'

/**
 * ImageExportService — exports embedded images to disk.
 *
 * All decoding/writing runs natively (`export_images_zip` / `export_single_image`): Rust reads
 * each image's base64 from SQLite and writes the file directly to a REAL destination path, so no
 * image bytes cross the IPC bridge or accumulate in the JS heap (which caused Android OOM
 * crashes). The destination is resolved per platform (save dialog on desktop, app external dir
 * on Android) — see resolveSaveTarget.
 */
class ImageExportService {
  private filterImages(
    images: EmbeddedImageMeta[],
    selectedIds?: Set<string>,
  ): EmbeddedImageMeta[] {
    return selectedIds ? images.filter((img) => selectedIds.has(img.id)) : images
  }

  async exportSingleImage(storyTitle: string, image: EmbeddedImageMeta): Promise<boolean> {
    try {
      const target = await resolveSaveTarget(`${storyTitle}-image.png`, [
        { name: 'PNG Image', extensions: ['png'] },
      ])
      if (!target) return false

      const written = await invoke<string>('export_single_image', {
        imageId: image.id,
        destPath: target.destPath,
      })
      console.log(`[ImageExport] Exported to ${written}`)
      return true
    } catch (error) {
      console.error('[ImageExport] Single image export failed:', error)
      throw error
    }
  }

  async exportImagesToZip(
    storyTitle: string,
    images: EmbeddedImageMeta[],
    selectedImageIds?: Set<string>,
  ): Promise<boolean> {
    const imagesToExport = this.filterImages(images, selectedImageIds)

    if (imagesToExport.length === 0) {
      throw new Error('No images to export')
    }

    try {
      const target = await resolveSaveTarget(`${storyTitle}-images.zip`, [
        { name: 'ZIP Archive', extensions: ['zip'] },
      ])
      if (!target) return false

      // Rust reads the base64 from SQLite and writes the ZIP directly; only ids cross IPC.
      const storyId = imagesToExport[0].storyId
      const ids = imagesToExport.map((img) => img.id)
      await invoke<string>('export_images_zip', {
        storyId,
        destPath: target.destPath,
        selectedIds: ids,
      })

      console.log(`[ImageExport] Exported ${imagesToExport.length} images`)
      return true
    } catch (error) {
      console.error('[ImageExport] ZIP export failed:', error)
      throw error
    }
  }

  async exportImages(
    storyTitle: string,
    images: EmbeddedImageMeta[],
    selectedImageIds?: Set<string>,
  ): Promise<boolean> {
    const imagesToExport = this.filterImages(images, selectedImageIds)

    if (imagesToExport.length === 0) {
      throw new Error('No images to export')
    }

    return imagesToExport.length === 1
      ? this.exportSingleImage(storyTitle, imagesToExport[0])
      : this.exportImagesToZip(storyTitle, images, selectedImageIds)
  }
}

export const imageExportService = new ImageExportService()
