import type { ComponentAnnotations, Renderer, StoryAnnotations } from 'storybook/internal/types'
import TermText from '../source-components/TermText.vue'

type Props = InstanceType<typeof TermText>['$props']

const meta = {
  id: 'geo-elements-term-text',
  title: '요소/용어 설명',
  component: TermText,
  args: { text: 'EPSG:4326 좌표계의 데이터를 MVT 벡터타일로 표시합니다.' },
  parameters: { docs: { description: { component: '원본 용어 카탈로그와 TermText를 사용합니다. 같은 용어에는 첫 등장에만 팝오버를 붙이며 실제 지도·변환 작업은 시작하지 않습니다.' } } },
} satisfies ComponentAnnotations<Renderer, Props>

export default meta

type Story = StoryAnnotations<Renderer, Props, Partial<Props>>

export const Explained: Story = {}

export const RepeatedTerm: Story = { args: { text: 'EPSG:4326을 확인하고 EPSG:4326 좌표계를 유지합니다.' } }

export const PlainText: Story = { args: { text: '불러온 자료를 확인한 뒤 다음 단계로 이동합니다.' } }
