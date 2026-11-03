import type { ComponentAnnotations, Renderer, StoryAnnotations } from 'storybook/internal/types'
import StepList from '../source-components/StepList.vue'

type Props = InstanceType<typeof StepList>['$props']

const meta = {
  title: '실제 컴포넌트/변환 단계',
  component: StepList,
  args: {
    steps: [{ tool: 'gdal', title: '무결성 확인', run: 'ogrinfo sample.geojson', why: '좌표계와 피처 수를 확인합니다.' }],
  },
} satisfies ComponentAnnotations<Renderer, Props>

export default meta

type Story = StoryAnnotations<Renderer, Props, Partial<Props>>

export const Waiting: Story = {}

export const Completed: Story = {
  args: { records: [{ stage: 'preprocess', run: 'ogrinfo sample.geojson', title: '무결성 확인', code: 0, ms: 1250, log: 'Feature Count: 2' }] },
}

export const Failed: Story = {
  args: { records: [{ stage: 'preprocess', run: 'ogrinfo sample.geojson', title: '무결성 확인', code: 1, ms: 240, log: 'Synthetic fixture: unsupported coordinate system.' }] },
}
