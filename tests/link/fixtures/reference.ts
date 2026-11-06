import type { ReferenceSnapshot } from '../../../shared/link/types.ts'

/** 단위 테스트용 소형 fixture. 운영 전국 사전으로 사용하지 않는다. */
export const fixture: ReferenceSnapshot = {
  version: 'test-fixture-v1', available: true, source: '단위 테스트 fixture', sourceUrl: '', sourceDate: null, checkedAt: null, activatedAt: null, coverage: 'fixture',
  regions: [
    { code: '1100000000', name: '서울특별시', fullName: '서울특별시', parentCode: null, level: 'sido', status: 'active' },
    { code: '1111000000', name: '종로구', fullName: '서울특별시 종로구', parentCode: '1100000000', level: 'sigungu', status: 'active' },
    { code: '1111010100', name: '청운동', fullName: '서울특별시 종로구 청운동', parentCode: '1111000000', level: 'eupmyeondong', status: 'active' },
    { code: '1111011900', name: '세종로', fullName: '서울특별시 종로구 세종로', parentCode: '1111000000', level: 'eupmyeondong', status: 'active' },
    { code: '1111015600', name: '종로1가', fullName: '서울특별시 종로구 종로1가', parentCode: '1111000000', level: 'eupmyeondong', status: 'active' },
    { code: '1111019900', name: '옛동', fullName: '서울특별시 종로구 옛동', parentCode: '1111000000', level: 'eupmyeondong', status: 'retired' },
    { code: '4100000000', name: '경기도', fullName: '경기도', parentCode: null, level: 'sido', status: 'active' },
    { code: '4111000000', name: '수원시', fullName: '경기도 수원시', parentCode: '4100000000', level: 'sigungu', status: 'active' },
    { code: '4111100000', name: '장안구', fullName: '경기도 수원시 장안구', parentCode: '4111000000', level: 'sigungu', status: 'active' },
    { code: '4111110100', name: '청운동', fullName: '경기도 수원시 장안구 청운동', parentCode: '4111100000', level: 'eupmyeondong', status: 'active' },
    { code: '4111300000', name: '권선구', fullName: '경기도 수원시 권선구', parentCode: '4111000000', level: 'sigungu', status: 'active' },
    { code: '4111325000', name: '시험읍', fullName: '경기도 수원시 권선구 시험읍', parentCode: '4111300000', level: 'eupmyeondong', status: 'active' },
    { code: '4111325021', name: '동리', fullName: '경기도 수원시 권선구 시험읍 동리', parentCode: '4111325000', level: 'ri', status: 'active' },
    { code: '4111325022', name: '서리', fullName: '경기도 수원시 권선구 시험읍 서리', parentCode: '4111325000', level: 'ri', status: 'active' },
    // 시도 명칭 변경(강원도 42 → 강원특별자치도 51)과 일반구 재설치(부천시 중동 → 부천시 원미구 중동)
    { code: '4200000000', name: '강원도', fullName: '강원도', parentCode: null, level: 'sido', status: 'retired' },
    { code: '4211000000', name: '춘천시', fullName: '강원도 춘천시', parentCode: '4200000000', level: 'sigungu', status: 'retired' },
    { code: '4211011200', name: '효자동', fullName: '강원도 춘천시 효자동', parentCode: '4211000000', level: 'eupmyeondong', status: 'retired' },
    { code: '5100000000', name: '강원특별자치도', fullName: '강원특별자치도', parentCode: null, level: 'sido', status: 'active' },
    { code: '5111000000', name: '춘천시', fullName: '강원특별자치도 춘천시', parentCode: '5100000000', level: 'sigungu', status: 'active' },
    { code: '5111011200', name: '효자동', fullName: '강원특별자치도 춘천시 효자동', parentCode: '5111000000', level: 'eupmyeondong', status: 'active' },
    { code: '4119000000', name: '부천시', fullName: '경기도 부천시', parentCode: '4100000000', level: 'sigungu', status: 'active' },
    { code: '4119010800', name: '중동', fullName: '경기도 부천시 중동', parentCode: '4119000000', level: 'eupmyeondong', status: 'retired' },
    { code: '4119200000', name: '원미구', fullName: '경기도 부천시 원미구', parentCode: '4119000000', level: 'sigungu', status: 'active' },
    { code: '4119210800', name: '중동', fullName: '경기도 부천시 원미구 중동', parentCode: '4119200000', level: 'eupmyeondong', status: 'active' },
    { code: '3611000000', name: '세종특별자치시', fullName: '세종특별자치시', parentCode: null, level: 'sido', status: 'active' },
    { code: '3611010100', name: '반곡동', fullName: '세종특별자치시 반곡동', parentCode: '3611000000', level: 'eupmyeondong', status: 'active' },
  ],
}
