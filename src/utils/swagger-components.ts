const components = {
    schemas: {
        User: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'user full name' },
                fullNames: { type: 'string', description: 'user full name' },
                email: { type: 'string', description: 'user email address' },
                status: { type: 'string', description: 'account password' },
                role: { type: 'string', description: 'account role' },
                createdAt: { type: 'string', description: 'user full name' }
            },
        },
        RegisterUserInput: {
            type: 'object',
            properties: {
                fullNames: { type:'string', description: 'user full name', default: '' },
                email: { type: 'string', description: 'user email address', default: '' },
                password: { type: 'string', description: 'account password', default: '' },
                role: { type: 'string', description: 'account role', default: '' }
            },
            required: ['fullNames', 'email', 'password', 'role'],
        },
        RegisterUserResponse: {
            type: 'object',
            properties: {
                message: { type: 'string',}
            },
        },
        LoginUserInput: {
            type: 'object',
            properties: {
                email: { type: 'string', description: 'user email address' },
                password: { type: 'string', description: 'account password' },
            },
            required: ['email', 'password'],
        },
        LoginUserResponse: {
            type: 'object',
            properties: {
                token: { type: 'string' },
                message: { type: 'string' },
                user: {
                    $ref: '#/components/schemas/User',
                },
            },
        },
        RequestNewPassword: {
            type: 'object',
            properties: {
                email: { type: 'string', description: 'user email address' },
            },
            required: ['email'],
        },
        SuccessResponse: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                message: { type: 'string', }
            },
        },
        ErrorResponse: {
            type: 'object',
            properties: {
                success: { type: 'boolean', default: false },
                message: { type: 'string', }
            },
        },
        RetriveAdmins: {
            type: 'object',
            properties: {
                message: { type: 'string' },
                admins: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'user full name' },
                            fullNames: { type: 'string', description: 'user full name' },
                            email: { type: 'string', description: 'user email address' },
                            role: { type: 'string', description: 'account role' },
                            createdAt: { type: 'string', description: 'user full name' }
                        },
                    },
                },
            },
        },
        Category: {
            type: 'object',
            properties: {
                status: { type: 'string' },
                message: { type: 'string' },
                data: {
                    type: 'object',
                    properties: {
                        id: { type: 'number' },
                        name: { type: 'string' }
                    }
                }
            }
        },
        Categories: {
            type: 'object',
            properties: {
                status: { type: 'string' },
                message: { type: 'string' },
                data: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'number' },
                            name: { type: 'string' }
                        }
                    }
                }
            }
        },
        AddTeamInput: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                position: { type: 'string' },
                description: { type: 'string' },
                youtube: { type: 'string' },
                linkedin: { type: 'string' },
                facebook: { type: 'string' },
                twitter: { type: 'string' },
                profilePicture: { type: 'file' },
            },
            required: ['name', 'position', 'description', 'youtube', 'linkedin', 'facebook', 'twitter', 'profilePicture'],
        },
        CommentInput: {
            type: 'object',
            properties: {
                content: { type:'string' },
                postId: { type: 'number' },
                authorId: { type: 'number' },
                parentId: { type: 'number', nullable: true },
            },
            required: ['content', 'postId', 'authorId'],
        },
        PostCreationInput: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                content: { type: 'string' },
                published: { type: 'boolean' },
                isFeatured: { type: 'boolean' },
                categoryIds: { type: 'string' },
                imageUrl: { type: 'file' },
            },
            required: ['title', 'content', 'published', 'isFeatured', 'categoryIds', 'imageUrl'],
        },
        LinkCreationModel: {
            type: 'object',
            properties: {
                amount: { type: 'string' },
                currency: { type: 'string' },
                email: { type: 'string' },
                fullNames: { type: 'string' },
                donationType: { type: 'string' },
                donationTitle: { type: 'string' }
            }
        }
    },
    securitySchemes: {
        bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
        },
    }
};

export default components
