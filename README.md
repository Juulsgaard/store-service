# Store Service

![NPM License](https://img.shields.io/npm/v/@juulsgaard/store-service)
![NPM License](https://img.shields.io/npm/l/@juulsgaard/store-service)
![NPM Downloads](https://img.shields.io/npm/dw/@juulsgaard/store-service)

A state management system for Javascript

## Description

Store Service is a state management library revolving around Stores and Commands.

A Store is a class with an internal state that can in turn be mutated by Commands added to the Store.
The state itself is immutable, so every command that affects the state uses a reducer to create a new state.
