using CastleApi.Models;

namespace CastleApi.Services;

public interface IScriptRunnerService
{
    Task<CastleTokenResponse> GenerateCastleTokenAsync(CastleTokenRequest request, CancellationToken cancellationToken = default);
    Task<TwitterAuthResponse> ExecuteTwitterAuthAsync(TwitterAuthRequest request, CancellationToken cancellationToken = default);
}
