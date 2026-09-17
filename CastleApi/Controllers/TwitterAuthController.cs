using CastleApi.Models;
using CastleApi.Services;
using Microsoft.AspNetCore.Mvc;

namespace CastleApi.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TwitterAuthController : ControllerBase
{
    private readonly IScriptRunnerService _scriptRunner;

    public TwitterAuthController(IScriptRunnerService scriptRunner)
    {
        _scriptRunner = scriptRunner;
    }

    [HttpPost("authenticate")]
    [ProducesResponseType(typeof(TwitterAuthResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(typeof(TwitterAuthResponse), StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Authenticate([FromBody] TwitterAuthRequest request, CancellationToken cancellationToken)
    {
        var result = await _scriptRunner.ExecuteTwitterAuthAsync(request, cancellationToken);
        if (!result.Success)
        {
            return BadRequest(result);
        }
        return Ok(result);
    }
}
