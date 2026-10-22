#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GeoRenderGameMode.generated.h"

class ACesium3DTileset;
class ACameraActor;

/**
 * 명령줄로 받은 3D Tiles(또는 quantized-mesh 지형 layer.json)를 Cesium for Unreal로 그려 스크린샷과 기록(JSON)을 남기고 끝낸다.
 *   -Tileset=<URL>  -Lon= -Lat= -Height=<원점 높이 m>  -Dist=<카메라 거리 m> -Pitch=<도, 0=수직 내려다봄> -Bearing=<도, 북=0>
 *   -Shot=<png 경로> -Report=<json 경로> [-Timeout=<초>] [-Basemap=<XYZ 주소 템플릿> [-Drape: 타일셋(지형) 위에 덮기]]
 * 끝나는 조건: 타일(+배경지도) 로드 100% + 셰이더 컴파일 끝이 90프레임 유지 → 스크린샷. 실패(로드 오류·시간 초과)도 기록을 남긴다
 */
UCLASS()
class AGeoRenderGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AGeoRenderGameMode();
	virtual void StartPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	void Finish(bool bOk, const FString& Error);

	UPROPERTY()
	TObjectPtr<ACesium3DTileset> Tileset;

	/** 배경지도를 까는 타원체 (지형이 아닐 때) */
	UPROPERTY()
	TObjectPtr<ACesium3DTileset> Ground;

	UPROPERTY()
	TObjectPtr<ACameraActor> Camera;

	FString Url, ShotPath, ReportPath, FailMessage;
	double Timeout = 600;
	double StartTime = 0, LoadedAt = 0;
	int32 StableFrames = 0;
	int32 ShotFrames = -1;
	int32 ExitIn = -1;
};
