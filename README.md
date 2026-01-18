# Iris-Client with Node.js

Iris-Client with Node.js는 [dolidolih](https://github.com/dolidolih)의 [irispy-client](https://github.com/dolidolih/irispy-client) 모듈을 Node.js로 변환한 라이브러리입니다. 카카오톡 봇 개발을 위한 기능을 제공합니다.

본 라이브러리는 Iris 서버와 HTTP Webhook 방식으로 통신하며,
이벤트 기반 구조를 통해 메시지 처리, 입·퇴장 감지, 사용자 및 채널 정보 조회 기능을 제공합니다. 

## 실행 환경
본 패키지는 스마트폰 환경에서 실행됩니다.

### 요구 사항
- 루팅된 안드로이드 기기
- Termux 
- Node.js
- Iris 서버

## 설치
해당 패키지는 스마트폰에서 실행됩니다.
루팅된 안드로이드 기기에서 Termux 앱을 사용하여 진행하세요.



### 이벤트 종류
Iris-Client는 Iris에서 전달되는 로그를 분석하여 다음과 같은 이벤트를 제공합니다.
- `message`: 일반 메시지
- `join`: 멤버 입장
- `leave`: 멤버 퇴장
- `kick`: 멤버 추방
- `delete`: 메시지 삭제
- `hide`: 메시지 가리기
- `error`: 오류 발생

### event 객체 구조
각 이벤트 핸들러에는 event 객체가 전달되며,
개발자는 해당 객체만을 이용하여 봇 로직을 구현할 수 있습니다.

#### message
```
event.message = {
  type,
  id,
  content,
  attachment: {
    file,
    prev,
    reply
  }
}
```
#### user
```
event.user = {
  id,
  name,
  image,
  profileType,
  memberType
}
```
#### channel
```
event.channel = {
  id,
  name,
  members
}
```
위 정보들은 Iris 데이터베이스(chat_logs, open_chat_member, chat_rooms)에서
자동으로 조회 및 정규화(normalize)되어 제공됩니다.

### 메시지 전송
채팅방으로 메시지를 전송할 때는 다음 API를 사용합니다.
```
await event.channel.send("메시지 내용");
```

### event.GET API
event 객체에는 DB 재조회를 위한 GET 메서드가 포함되어 있습니다.
```
const user = await event.GET("user", event.user.id);
```
지원 타입
|type|조회 대상 테이블|
|----|-----------------|
|"user"|open_chat_member|
|"channel"|chat_rooms|
|"message"|chat_logs|

해당 메서드는 조회 결과를 normalize된 객체로 반환합니다.


### 관리자 콘솔 (eval)
개발 및 디버깅 목적으로 eval 콘솔을 구현할 수 있습니다.
- AsyncFunction 기반
- await 사용 가능

**⚠️ 해당 기능은 테스트 및 관리 목적에 한해 사용을 권장합니다.**


## 예시
자세한 사용 예시는 [example.js](https://github.com/TeamCloud-SHBot/IrisJS-Client/blob/main/example.js)를 참고하세요.

## 라이선스
[MIT](https://github.com/TeamCloud-SHBot/IrisJS-Client/LICENSE)

## 참조
- [irispy-client](https://github.com/dolidolih/irispy-client) by [@dolidolih](https://github.com/dolidolih)

## 면책 조항
해당 프로젝트로 발생하는 모든 불이익에 대하여 책임지지 않습니다.
