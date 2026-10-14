# GA4 이벤트 기록

측정 ID: `G-Q0DH99MGN0`.

Google 태그는 `index.html`에 설치되어 있습니다. 사용자 동작의 이벤트 전송은 `src/analytics.ts`, 연결 지점은 `src/main.ts`, `src/world.ts`, `src/wizard-visit.ts`, `src/speech.ts`에 있습니다.

## 예제별 시작과 종료

강아지·자동차·인간·마법사는 같은 이벤트 이름에 `example_type`으로 구분합니다.

| 화면의 예제 | example_type |
| --- | --- |
| 치와와 | `dog` |
| 경차 | `car` |
| 인간 | `human` |
| 마법사 | `wizard` |

| 이벤트 이름 | 기록 시점 | 주요 매개변수 |
| --- | --- | --- |
| `example_request` | 실행 가능한 아이콘을 클릭했을 때 | `example_type`, `pigeon_count` |
| `example_start` | 모델 준비가 끝나고 효과가 실제로 생성됐을 때 | 위 항목, `load_duration_ms` |
| `example_end` | 효과와 비둘기 복귀가 완전히 끝났을 때. 시작 전 실패하거나 페이지를 떠난 경우에도 시도를 종료 | 위 항목, `started`, `outcome`, `end_reason`, `duration_ms`, `total_duration_ms` |
| `example_error` | 모델·카메라·손 추적 등으로 예제를 실행하거나 유지하지 못했을 때 | `example_type`, `pigeon_count`, `stage`, `error_code` |
| `example_milestone` | 아래 주요 단계에 처음 도달했을 때. 단계마다 예제 실행 1회당 최대 1번 | `example_type`, `pigeon_count`, `milestone` |

`milestone` 값:

- `first_scare`: 치와와 때문에 비둘기가 처음 놀라 날아감.
- `first_collision`: 자동차가 비둘기를 처음 침.
- `scare_gesture`: 인간이 비둘기를 놀라게 하는 자세를 취함.
- `return_started`: 치와와·자동차·인간 효과 뒤 비둘기가 복귀하기 시작함.

자동차의 `example_end`에는 전체 충돌 횟수인 `hit_count`도 포함됩니다. 같은 비둘기를 두 번 친 경우 2회로 집계합니다. 개별 비둘기 ID와 좌표는 전송하지 않습니다.

아이콘 재활성화와 완전한 복귀는 시점이 다를 수 있으므로, 버튼이 다시 활성화됐다는 이유로 `example_end`를 기록하지 않습니다. 중복 종료 신호는 무시합니다.

## 마법사 조종

| 이벤트 이름 | 기록 시점 | 주요 매개변수 |
| --- | --- | --- |
| `wizard_control_start` | 마법사가 착지·회전을 마치고 손 추적 모델도 준비된 순간 | `example_type`, `pigeon_count` |
| `wizard_control_end` | 조종 시간 종료, 카메라 종료 버튼 클릭, 오류 또는 페이지 이탈 | 위 항목, `end_reason`, `duration_ms` |
| `wizard_pattern` | 비둘기가 비행·리본·회오리 패턴을 실제로 사용했을 때 | 위 항목, `pattern` |

`pattern`은 `flying`, `ribbon`, `vortex`입니다. 같은 패턴은 마법사 실행 1회당 한 번만 기록하므로 손 추적 프레임마다 이벤트가 쌓이지 않습니다. 한 번의 마법사 실행에서는 최대 3개입니다.

## 카메라와 참여 동작

| 이벤트 이름 | 기록 시점 | 주요 매개변수 |
| --- | --- | --- |
| `camera_open` | 얼굴 촬영 창 또는 마법사 카메라 창을 열었을 때 | `camera_purpose` |
| `camera_ready` | 카메라 영상이 준비됐을 때. 마법사 손 추적 모델 준비 완료와는 별개 | `camera_purpose` |
| `camera_close` | 카메라 창이 닫혔을 때 | `camera_purpose`, 얼굴 촬영의 경우 `outcome` |
| `camera_error` | 얼굴 촬영용 카메라 준비 실패 | `camera_purpose`, `error_code` |
| `pigeon_create_start` | 촬영 후 비둘기 생성 처리를 시작했을 때 | `pigeon_count` |
| `pigeon_create_end` | 비둘기 저장·생성 성공, 실패 또는 생성 전 취소 | `pigeon_count`, `outcome`, `duration_ms`, 실패 시 `error_code` |
| `pigeon_delete_start` | 삭제 확인 창에서 OK를 누르고 실제 삭제를 시작했을 때 | `pigeon_count` |
| `pigeon_delete_end` | 저장소 삭제와 블랙홀 애니메이션·동기화 완료 또는 실패 | `pigeon_count`, `outcome`, `duration_ms`, 실패 시 `error_code` |
| `speech_open` | 말풍선 입력창을 열었을 때 | 없음 |
| `speech_saved` | 수정된 말풍선이 저장소에 실제로 저장됐을 때 | `character_count` |
| `speech_error` | 말풍선 저장 실패 | `error_code` |

`camera_purpose`는 `pigeon` 또는 `wizard`입니다. 마법사 카메라·손 추적 오류는 `example_error`로 기록합니다. `speech_saved`의 글자 수는 자동 생성된 9와 점을 제외한 직접 입력 문자 수이며, 같은 내용의 중복 저장은 중복 집계하지 않습니다.

## 완료 상태와 시간

`outcome` 값:

- `completed`: 정상 완료. 마법사의 시간 만료도 포함.
- `failed`: 실제 오류로 실패.
- `cancelled`: 사용자 종료, 페이지 이동 또는 시작 전 취소.

`end_reason`은 `completed`, `timeout`, `user_close`, `page_hidden`, `page_leave`, `error`, `cancelled`, `not_started` 중 하나입니다. `started=0`은 예제가 실제로 등장하기 전에 시도가 끝났다는 뜻입니다.

`duration_ms`는 실제 시작 이후의 시간, `total_duration_ms`는 아이콘 클릭 이후 전체 시간, `load_duration_ms`는 클릭 후 예제 시작까지 준비 시간입니다. 모두 밀리초입니다. 이벤트 자체의 발생 시점은 GA4가 기록합니다.

`error_code`는 `permission_denied`, `device_missing`, `device_busy`, `security_error`, `aborted`, `timeout`, `network_or_unsupported`, `operation_failed`처럼 고정된 분류만 전송합니다.

얼굴 사진·영상, 손 좌표, 말풍선 내용, 비둘기 ID, 소유권 토큰, 원본 오류 메시지는 이 사용자 정의 이벤트에 넣지 않습니다. GA 태그가 없거나 차단되거나 예외를 던져도 사이트 동작은 계속됩니다. 웹사이트 디자인과 애니메이션 계산은 변경하지 않았습니다.

## Google Analytics에서 확인할 설정

이벤트는 코드 배포 후 수집됩니다. 이 문서 작성 시 계정의 보고서 설정은 직접 변경하지 않았습니다.

예제 종류와 패턴 등의 매개변수를 보고서에서 사용하려면 **관리 → 데이터 표시 → 맞춤 정의 → 맞춤 측정기준 만들기**에서 범위를 **이벤트**로 선택하고 아래 항목을 등록합니다. 매개변수 이름은 정확히 입력합니다.

| 권장 표시 이름 | 이벤트 매개변수 |
| --- | --- |
| 예제 종류 | `example_type` |
| 완료 상태 | `outcome` |
| 종료 이유 | `end_reason` |
| 주요 단계 | `milestone` |
| 마법사 패턴 | `pattern` |
| 카메라 용도 | `camera_purpose` |
| 오류 종류 | `error_code` |
| 오류 단계 | `stage` |

필수로 먼저 등록할 항목은 `example_type`, `outcome`, `pattern`입니다. 시간·충돌 횟수·문자 수·개체 수를 수치로 분석하려면 맞춤 측정항목으로 `duration_ms`, `total_duration_ms`, `load_duration_ms`, `hit_count`, `character_count`, `pigeon_count`를 추가합니다. 시간 값은 밀리초로 전송됩니다.

등록 후 **탐색**에서 이벤트 이름과 예제 종류를 행에, 이벤트 수를 값에 넣으면 각 예제의 요청·실제 시작·완료 횟수를 비교할 수 있습니다. `outcome`으로 정상 완료와 오류·취소를 나눌 수 있습니다. 맞춤 정의가 보고서에 사용 가능해지기까지 Google 안내상 24~48시간이 걸릴 수 있습니다.

공식 문서: [GA4 이벤트 전송](https://developers.google.com/analytics/devguides/collection/ga4/events), [이벤트 매개변수](https://developers.google.com/analytics/devguides/collection/ga4/event-parameters), [이벤트 범위 맞춤 측정기준](https://support.google.com/analytics/answer/14239696), [맞춤 정의의 처리 시간](https://support.google.com/analytics/answer/14240153).

## 검증

```powershell
npm.cmd run test:analytics
npm.cmd run test:analytics-browser
npm.cmd run test:mobile-speech
npm.cmd run build
```

분석 테스트는 Google로 실제 테스트 이벤트를 보내지 않습니다. 실제 사용자 동작 핸들러를 실행하고 데이터 전송 큐를 검사하며, 3D·저장소·카메라 모델은 해당 분석 통합 테스트에서 대체합니다. 그래픽·손 조종 검증은 별도의 기존 예제 테스트로 확인합니다.

이번 작업의 검증 결과:

- 분석 단위 테스트 7개와 실제 UI 동작 핸들러의 분석 통합 테스트 통과.
- Chromium/Edge·WebKit·Firefox의 모바일 입력 테스트 통과.
- 인간·강아지·자동차의 기존 그래픽/행동 테스트 통과.
- 빌드 통과.
- 기존 마법사 테스트는 비둘기 가장자리 밀집 검사에서 실패했습니다(가장자리에 6~8마리, 기존 조건은 6마리 미만). 이번 작업에서 이 조종 로직을 변경하지 않았습니다. 이벤트 추가 전후를 같은 난수·입력으로 별도 비교한 결과, PC·모바일 비율 각각 40마리·650단계에서 카메라와 비둘기 위치·회전·속도·머리·목·날개 상태의 최대 차이는 0이었습니다. 가장자리 밀집 문제는 별도 수정 대상으로 남아 있습니다.
