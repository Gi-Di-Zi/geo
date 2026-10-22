using UnrealBuildTool;

// 패키징 없이 에디터 실행 파일의 -game 모드로 돈다 → 이 타깃만 빌드하면 된다
public class GeoRenderEditorTarget : TargetRules
{
	public GeoRenderEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("GeoRender");
	}
}
