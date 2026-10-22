using UnrealBuildTool;

public class GeoRender : ModuleRules
{
	public GeoRender(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		// CesiumRuntime: Cesium for Unreal 액터, RHI: GPU 이름, Projects: 플러그인 버전, Json: 기록 파일
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "RHI", "Projects", "Json", "CesiumRuntime" });
	}
}
