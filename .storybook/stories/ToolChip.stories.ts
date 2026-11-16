import type { ComponentAnnotations, Renderer, StoryAnnotations } from 'storybook/internal/types'
import ToolChip from '../source-components/ToolChip.vue'

type Props = InstanceType<typeof ToolChip>['$props']

const meta = {
  id: 'geo-elements-tool-chip',
  title: '요소/도구 설명',
  component: ToolChip,
  args: { id: 'gdal' },
  parameters: { docs: { description: { component: 'Geo의 원본 도구 칩과 프로젝트 도구 카탈로그를 사용합니다. 팝오버는 설명만 표시하며 도구를 실행하지 않습니다. 자세히 보기 링크는 기존 미리보기 mock입니다.' } } },
} satisfies ComponentAnnotations<Renderer, Props>

export default meta

type Story = StoryAnnotations<Renderer, Props, Partial<Props>>

export const KnownTool: Story = {}

export const UnknownTool: Story = { args: { id: 'storybook-unregistered-tool' } }
