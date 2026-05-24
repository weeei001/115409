from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field


NewPassword = Annotated[str, Field(min_length=8, max_length=128)]


class RegisterRequest(BaseModel):
    email: EmailStr = Field(..., description="註冊 email，系統會以小寫與去除前後空白後儲存")
    password: NewPassword = Field(..., description="登入密碼，長度 8 到 128 字元")
    display_name: str | None = Field(default=None, max_length=255, description="顯示名稱，可留空")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "email": "user@example.com",
                "password": "StrongPass123",
                "display_name": "測試使用者",
            }
        }
    )


class LoginRequest(BaseModel):
    email: EmailStr = Field(..., description="已註冊的 email")
    password: str = Field(..., min_length=1, max_length=128, description="登入密碼")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "email": "user@example.com",
                "password": "StrongPass123",
            }
        }
    )


class GoogleAuthRequest(BaseModel):
    id_token: str = Field(..., min_length=10, description="Google Sign-In 取得的 id_token")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij..."
            }
        }
    )


class UserPublic(BaseModel):
    id: int = Field(..., description="使用者流水號")
    email: str = Field(..., description="使用者 email")
    display_name: str | None = Field(None, description="顯示名稱")

    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "id": 1,
                "email": "user@example.com",
                "display_name": "測試使用者",
            }
        },
    )


class TokenResponse(BaseModel):
    access_token: str = Field(..., description="JWT access token，呼叫需登入 API 時放在 Authorization Bearer")
    token_type: str = Field("bearer", description="Token 類型")
    expires_in: int = Field(..., description="Token 有效秒數")
    user: UserPublic = Field(..., description="登入使用者公開資訊")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
                "token_type": "bearer",
                "expires_in": 604800,
                "user": {
                    "id": 1,
                    "email": "user@example.com",
                    "display_name": "測試使用者",
                },
            }
        }
    )


class ForgotPasswordRequest(BaseModel):
    email: EmailStr = Field(..., description="要重設密碼的 email")

    model_config = ConfigDict(json_schema_extra={"example": {"email": "user@example.com"}})


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=20, max_length=512, description="忘記密碼信件中的重設 token")
    new_password: NewPassword = Field(..., description="新密碼，長度 8 到 128 字元")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "token": "reset-token-from-email",
                "new_password": "NewStrongPass123",
            }
        }
    )


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128, description="目前密碼")
    new_password: NewPassword = Field(..., description="新密碼，長度 8 到 128 字元")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "current_password": "StrongPass123",
                "new_password": "NewStrongPass123",
            }
        }
    )


class MessageResponse(BaseModel):
    message: str = Field(..., description="操作結果訊息")

    model_config = ConfigDict(json_schema_extra={"example": {"message": "操作已完成。"}})
