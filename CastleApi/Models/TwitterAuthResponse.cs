namespace CastleApi.Models;

public class TwitterAuthResponse
{
    public bool Success { get; set; }
    public string? AuthToken { get; set; }
    public string? Ct0 { get; set; }
    public string? Twid { get; set; }
    public string? ErrorMessage { get; set; }
    public long ExecutionTimeMs { get; set; }
}
