# CFB Sideline Assistant

Sideline Assistant is a football game-management decision tool built for fast sideline use. It helps coaches quickly apply decision charts for two-point conversions, penalty accept/decline situations, and late-half clock management.

The app supports both AI-powered voice/text input and a fully manual input mode, so teams can still use the core chart logic even when Wi-Fi or cell service is unreliable.

## Features

### Two-Point Conversion Decisions

Sideline Assistant helps determine whether to go for two or kick the extra point based on:

- Score margin after the touchdown
- Game/time bucket
- Digitized PFF two-point conversion chart logic

Coaches can use AI voice/text input, dropdowns, or the tappable chart grid.

### Penalty Accept/Decline Decisions

The penalty tool compares:

- The accepted-penalty result
- The actual play result if the penalty is declined
- Whether the team is on offense or defense

It then recommends whether to accept or decline the penalty based on the digitized penalty chart.

### Clock Management

The clock management tool estimates how much time the opponent would get back if the offense runs a normal clock-draining sequence. It helps coaches understand:

- How constrained the opponent’s next possession would be
- Whether one more first down is especially valuable
- Whether the offense should prioritize conversion, clock burn, ball security, or avoiding free stoppages

This feature is designed for late-half or late-game situations where the offense has the ball and wants to manage the remaining clock.

### AI Input

The app can take spoken or typed football situations and use OpenAI to extract structured game fields. The AI does not make the football decision. It only converts messy coach speech into clean inputs for the deterministic chart logic.

Example:

```text
Up 6, 5:30 left in the fourth
