using UnrealBuildTool;

public class GeoRenderTarget : TargetRules
{
	public GeoRenderTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("GeoRender");
	}
}
