"""py3dtiles 타일셋의 refine 값을 바로잡는다.

py3dtiles는 점을 노드마다 겹치지 않게 나눠 담는다(부모 + 자식 = 전체 점).
그래서 미리보기 루트만 REPLACE이고 그 아래는 ADD가 맞는데, 출력에서는 첫 노드도 REPLACE로 적힌다.
첫 노드가 REPLACE면 Cesium은 다 내려간 뒤 그 노드의 점을 숨기고,
Deck.gl(loaders.gl)은 자식 타일을 요청하지 않아 거친 단계에 머문다.

사용: python fix_refine.py <tileset.json>
"""
import json
import sys

path = sys.argv[1]
with open(path) as f:
    tileset = json.load(f)

fixed = 0
for child in tileset['root'].get('children', []):
    if child.get('refine') == 'REPLACE':
        child['refine'] = 'ADD'
        fixed += 1

with open(path, 'w') as f:
    json.dump(tileset, f)
print(f'첫 노드 {fixed}개의 refine을 REPLACE → ADD로 바꿨어요')
