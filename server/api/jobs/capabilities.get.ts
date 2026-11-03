// 업로드 화면이 제공 방식 카드를 그릴 때 묻는다: 이 실행 환경이 48시간 임시 공간 서비스 발행을 허용하는지 (공개 배포는 파일만).
// 공개 배포에서도 작업자가 답한다(service: false). 응답이 없으면 화면은 서비스 미제공으로 본다
import { SERVICE_HOURS } from '#shared/conversion'

export default defineEventHandler(() => ({ service: serviceEnabled(), serviceHours: SERVICE_HOURS, retention: FILE_RETENTION }))
