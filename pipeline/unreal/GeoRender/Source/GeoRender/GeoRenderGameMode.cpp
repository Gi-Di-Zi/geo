#include "GeoRenderGameMode.h"

#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Cesium3DTileset.h"
#include "CesiumGeoreference.h"
#include "CesiumUrlTemplateRasterOverlay.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Dom/JsonObject.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Interfaces/IPluginManager.h"
#include "Misc/EngineVersion.h"
#include "Misc/FileHelper.h"
#include "RHI.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "UnrealClient.h"
#if WITH_EDITOR
#include "ShaderCompiler.h"
#endif

AGeoRenderGameMode::AGeoRenderGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	// 조작할 폰 없이 고정 카메라 하나로 본다
	DefaultPawnClass = nullptr;
}

void AGeoRenderGameMode::StartPlay()
{
	Super::StartPlay();
	StartTime = FPlatformTime::Seconds();

	const TCHAR* Cmd = FCommandLine::Get();
	double Lon = 0, Lat = 0, Height = 0, Dist = 1000, Pitch = 45, Bearing = 0;
	FParse::Value(Cmd, TEXT("Tileset="), Url);
	FParse::Value(Cmd, TEXT("Shot="), ShotPath);
	FParse::Value(Cmd, TEXT("Report="), ReportPath);
	FParse::Value(Cmd, TEXT("Lon="), Lon);
	FParse::Value(Cmd, TEXT("Lat="), Lat);
	FParse::Value(Cmd, TEXT("Height="), Height);
	FParse::Value(Cmd, TEXT("Dist="), Dist);
	FParse::Value(Cmd, TEXT("Pitch="), Pitch);
	FParse::Value(Cmd, TEXT("Bearing="), Bearing);
	FParse::Value(Cmd, TEXT("Timeout="), Timeout);
	FString Basemap;
	FParse::Value(Cmd, TEXT("Basemap="), Basemap);
	if (Url.IsEmpty() || ShotPath.IsEmpty() || ReportPath.IsEmpty())
	{
		FailMessage = TEXT("-Tileset, -Shot, -Report 필요");
		return;
	}

	UWorld* World = GetWorld();

	// 원점 = 시점이 바라보는 지점. 이 점이 언리얼 좌표 (0,0,0)
	ACesiumGeoreference::GetDefaultGeoreference(World)->SetOriginLongitudeLatitudeHeight(FVector(Lon, Lat, Height));

	// 조명: 해 + 대기 + 하늘빛(대기를 실시간으로 담는다). 런타임에 만드니 모두 Movable
	ADirectionalLight* Sun = World->SpawnActor<ADirectionalLight>(FVector::ZeroVector, FRotator(-50, 135, 0));
	Sun->GetLightComponent()->SetMobility(EComponentMobility::Movable);
	Cast<UDirectionalLightComponent>(Sun->GetLightComponent())->SetAtmosphereSunLight(true);
	World->SpawnActor<ASkyAtmosphere>();
	ASkyLight* Sky = World->SpawnActor<ASkyLight>();
	USkyLightComponent* SkyComp = Sky->GetLightComponent();
	SkyComp->SetMobility(EComponentMobility::Movable);
	SkyComp->bRealTimeCapture = true;
	SkyComp->RecaptureSky();

	Tileset = World->SpawnActor<ACesium3DTileset>();
	Tileset->SetTilesetSource(ETilesetSource::FromUrl);
	Tileset->SetUrl(Url);
	// 바닥: 웹 뷰어처럼 배경지도. 지형이면 지형 위에 덮고(-Drape), 아니면 높이 0 타원체에 깐다
	if (!Basemap.IsEmpty())
	{
		const bool bDrape = FParse::Param(Cmd, TEXT("Drape"));
		if (!bDrape)
		{
			Ground = World->SpawnActor<ACesium3DTileset>();
			Ground->SetTilesetSource(ETilesetSource::FromEllipsoid);
		}
		ACesium3DTileset* Target = bDrape ? Tileset.Get() : Ground.Get();
		UCesiumUrlTemplateRasterOverlay* Map = NewObject<UCesiumUrlTemplateRasterOverlay>(Target);
		Map->TemplateUrl = Basemap;
		Map->MaximumLevel = 19;
		Target->AddInstanceComponent(Map);
		Map->RegisterComponent();
	}
	OnCesium3DTilesetLoadFailure.AddLambda([this](const FCesium3DTilesetLoadFailureDetails& Details) {
		FailMessage = FString::Printf(TEXT("로드 실패 (HTTP %lld): %s"), Details.HttpStatusCode, *Details.Message);
	});

	// 카메라: 원점에서 방위 반대쪽으로 물러나 기울기만큼 위에서 내려다본다. Cesium 원점 기준 +X 동, +Y 남, +Z 위 (cm)
	const double P = FMath::DegreesToRadians(Pitch), B = FMath::DegreesToRadians(Bearing);
	const double Across = Dist * FMath::Sin(P);
	const FVector Pos(-Across * FMath::Sin(B) * 100, Across * FMath::Cos(B) * 100, Dist * FMath::Cos(P) * 100);
	Camera = World->SpawnActor<ACameraActor>(Pos, (-Pos).Rotation());
	Camera->GetCameraComponent()->SetFieldOfView(60);
}

void AGeoRenderGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (ExitIn >= 0)
	{
		if (ExitIn-- == 0) FGenericPlatformMisc::RequestExit(false);
		return;
	}
	if (!FailMessage.IsEmpty()) return Finish(false, FailMessage);

	// 폰이 없어 컨트롤러가 다시 자기 자신을 보게 될 수 있다 → 매 프레임 카메라로 고정
	if (APlayerController* PC = GetWorld()->GetFirstPlayerController(); PC && Camera && PC->GetViewTarget() != Camera)
	{
		PC->SetViewTarget(Camera);
	}

	// 스크린샷 요청 뒤: 저장이 끝나 요청 표시가 내려가면 기록을 쓰고 끝낸다
	if (ShotFrames >= 0)
	{
		if (!FScreenshotRequest::IsScreenshotRequested() && ++ShotFrames > 10) Finish(true, FString());
		return;
	}

	const double Now = FPlatformTime::Seconds();
	if (Now - StartTime > Timeout)
	{
		return Finish(false, FString::Printf(TEXT("시간 초과 %.0f초 (로드 %.0f%%)"), Timeout, Tileset ? Tileset->GetLoadProgress() : 0.f));
	}

	bool bReady = Tileset && Tileset->GetLoadProgress() >= 100.f && (!Ground || Ground->GetLoadProgress() >= 100.f) && Now - StartTime > 2;
#if WITH_EDITOR
	// -game을 에디터 실행 파일로 돌리면 재질 셰이더를 처음에 컴파일한다. 끝나기 전 화면은 재질이 빠져 있다
	bReady = bReady && !(GShaderCompilingManager && GShaderCompilingManager->IsCompiling());
#endif
	if (!bReady)
	{
		StableFrames = 0;
		return;
	}
	if (StableFrames++ == 0) LoadedAt = Now;
	// 90프레임: 배경지도 타일이 덮이고 시간 누적 안티에일리어싱(TSR)이 자리 잡을 때까지
	if (StableFrames >= 90)
	{
		FScreenshotRequest::RequestScreenshot(ShotPath, false, false);
		ShotFrames = 0;
	}
}

void AGeoRenderGameMode::Finish(bool bOk, const FString& Error)
{
	TSharedRef<FJsonObject> J = MakeShared<FJsonObject>();
	J->SetBoolField(TEXT("ok"), bOk);
	J->SetStringField(TEXT("url"), Url);
	J->SetNumberField(TEXT("loadMs"), FMath::RoundToInt(((LoadedAt > 0 ? LoadedAt : FPlatformTime::Seconds()) - StartTime) * 1000));
	J->SetStringField(TEXT("gpu"), GRHIAdapterName);
	J->SetStringField(TEXT("engine"), FEngineVersion::Current().ToString(EVersionComponent::Patch));
	if (TSharedPtr<IPlugin> Cesium = IPluginManager::Get().FindPlugin(TEXT("CesiumForUnreal")))
	{
		J->SetStringField(TEXT("cesium"), Cesium->GetDescriptor().VersionName);
	}
	if (!Error.IsEmpty()) J->SetStringField(TEXT("error"), Error);

	FString Out;
	FJsonSerializer::Serialize(J, TJsonWriterFactory<>::Create(&Out));
	if (!ReportPath.IsEmpty()) FFileHelper::SaveStringToFile(Out, *ReportPath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
	UE_LOG(LogTemp, Display, TEXT("GeoRender: %s"), *Out);
	// 몇 프레임 더 돌려 남은 파일 쓰기를 마친 뒤 끝낸다
	ExitIn = 30;
}
