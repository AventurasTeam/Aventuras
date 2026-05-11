import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

import { EmbedderDownloadDialogView } from './embedder-download-dialog'
import type {
  DialogState,
  FailReason,
  ImportBundle,
  ModelMeta,
} from './embedder-download-dialog-machine'

const sampleMeta: ModelMeta = {
  displayName: 'MiniLM-L6 (lightweight)',
  source: 'huggingface.co/Xenova/all-MiniLM-L6-v2-q8',
  revision: 'abc123def456',
  sizeBytes: 25_000_000,
  fileCount: 3,
}

const sampleBundle: ImportBundle = {
  modelId: 'my-org/my-finetune',
  files: [
    { name: 'model.onnx', path: '/tmp/model.onnx', sizeBytes: 42_000_000 },
    { name: 'tokenizer.json', path: '/tmp/tokenizer.json', sizeBytes: 1_200_000 },
    { name: 'tokenizer_config.json', path: '/tmp/tokenizer_config.json', sizeBytes: 3_000 },
  ],
}

const APACHE_2 = `Apache License
Version 2.0, January 2004

http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
…`

const LONG_LICENSE = APACHE_2.repeat(20)

const noop = () => {}
const noopHandlers = {
  onAcceptLicense: noop,
  onDeclineLicense: noop,
  onSubmitHfInput: noop,
  onPickEp: noop,
  onConfirmImport: noop,
  onCancel: noop,
  onRetry: noop,
  onClose: noop,
  onOpenChange: noop,
}

const meta: Meta<typeof EmbedderDownloadDialogView> = {
  title: 'Compounds/EmbedderDownloadDialog',
  component: EmbedderDownloadDialogView,
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof EmbedderDownloadDialogView>

const story = (state: DialogState): Story => ({
  args: { open: true, state, ...noopHandlers },
})

export const HfInput = story({ kind: 'hf-input' })
export const Resolving = story({
  kind: 'resolving',
  init: { kind: 'hf-id', input: 'Xenova/all-MiniLM-L6-v2-q8' },
})
export const CardFetch = story({ kind: 'card-fetch', meta: sampleMeta })
export const License_Apache = story({
  kind: 'license',
  meta: sampleMeta,
  licenseText: APACHE_2,
  licenseName: 'Apache 2.0',
})
export const License_NoLicense = story({
  kind: 'license',
  meta: sampleMeta,
  licenseText: '(no license text was found in the model card)',
  licenseName: '',
})
export const License_LongText = story({
  kind: 'license',
  meta: sampleMeta,
  licenseText: LONG_LICENSE,
  licenseName: 'Apache 2.0',
})
export const EpPicker = story({ kind: 'ep-picker', meta: sampleMeta, pickedEp: 'cpu' })
export const ImportConfirm = story({
  kind: 'import-confirm',
  bundle: sampleBundle,
  pickedEp: 'cpu',
})

export const Downloading_Initial = story({
  kind: 'downloading',
  meta: sampleMeta,
  progressByFile: {
    'model.onnx': { kind: 'downloading', bytesReceived: 0, bytesTotal: 25_000_000 },
    'tokenizer.json': { kind: 'waiting' },
    'tokenizer_config.json': { kind: 'waiting' },
  },
})
export const Downloading_MidFlight = story({
  kind: 'downloading',
  meta: sampleMeta,
  progressByFile: {
    'model.onnx': { kind: 'downloading', bytesReceived: 18_000_000, bytesTotal: 25_000_000 },
    'tokenizer.json': { kind: 'waiting' },
    'tokenizer_config.json': { kind: 'waiting' },
  },
})
export const Downloading_Final = story({
  kind: 'downloading',
  meta: sampleMeta,
  progressByFile: {
    'model.onnx': { kind: 'done' },
    'tokenizer.json': { kind: 'done' },
    'tokenizer_config.json': { kind: 'downloading', bytesReceived: 2_000, bytesTotal: 3_000 },
  },
})

export const Verifying_AllPending = story({
  kind: 'verifying',
  meta: sampleMeta,
  verifyByFile: {
    'model.onnx': 'pending',
    'tokenizer.json': 'pending',
    'tokenizer_config.json': 'pending',
  },
})
export const Verifying_Partial = story({
  kind: 'verifying',
  meta: sampleMeta,
  verifyByFile: {
    'model.onnx': 'ok',
    'tokenizer.json': 'ok',
    'tokenizer_config.json': 'pending',
  },
})

export const Done = story({ kind: 'done', meta: sampleMeta })

const failed = (reason: FailReason): Story => story({ kind: 'failed', meta: sampleMeta, reason })

export const Failed_CardFetch = failed({
  kind: 'card-fetch-failed',
  message: 'Network unreachable (no response after 3 retries)',
})
export const Failed_Resolve = failed({
  kind: 'resolve-failed',
  message: 'Model not found on huggingface.co',
})
export const Failed_Validation = failed({
  kind: 'validation-failed',
  missingFiles: ['tokenizer.json', 'tokenizer_config.json'],
})
export const Failed_HashMismatch = failed({
  kind: 'hash-mismatch',
  failingFile: 'tokenizer.json',
})
export const Failed_SmokeTest = failed({
  kind: 'smoke-test-failed',
  ep: 'webgpu',
})

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-4"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <EmbedderDownloadDialogView
            open
            state={{
              kind: 'license',
              meta: sampleMeta,
              licenseText: APACHE_2,
              licenseName: 'Apache 2.0',
            }}
            {...noopHandlers}
          />
        </View>
      ))}
    </View>
  ),
}
