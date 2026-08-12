# Android build environment. Nothing lands on the host except the APK.
#
# The same image is the Jenkins agent: the build is one `gradle` invocation with
# no host state, so a pipeline step is `docker run` with the workspace mounted.

FROM eclipse-temurin:17-jdk-jammy

ARG ANDROID_TOOLS_VERSION=11076708
ARG ANDROID_PLATFORM=android-34
ARG ANDROID_BUILD_TOOLS=34.0.0
ARG GRADLE_VERSION=8.9

ENV ANDROID_HOME=/opt/android-sdk \
    GRADLE_HOME=/opt/gradle \
    DEBIAN_FRONTEND=noninteractive
ENV PATH="${GRADLE_HOME}/bin:${ANDROID_HOME}/platform-tools:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Android SDK command-line tools
RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" \
    && curl -fsSL -o /tmp/tools.zip \
       "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_TOOLS_VERSION}_latest.zip" \
    && unzip -q /tmp/tools.zip -d "${ANDROID_HOME}/cmdline-tools" \
    && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest" \
    && rm /tmp/tools.zip

# Licences are accepted here, at image build time, so the build itself is
# non-interactive and the acceptance is visible in this file rather than hidden
# in someone's home directory.
RUN yes | "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null \
    && "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --install \
       "platform-tools" \
       "platforms;${ANDROID_PLATFORM}" \
       "build-tools;${ANDROID_BUILD_TOOLS}" > /dev/null

RUN curl -fsSL -o /tmp/gradle.zip \
       "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
    && unzip -q /tmp/gradle.zip -d /opt \
    && mv "/opt/gradle-${GRADLE_VERSION}" "${GRADLE_HOME}" \
    && rm /tmp/gradle.zip

# The container runs as the invoking user so the APK is not written to the host
# as root. That user has no home directory here, so the run must point HOME at
# something writable — the Android Gradle plugin writes to $HOME/.android during
# configuration and fails the build outright if it cannot.
RUN chmod -R a+rwX "${ANDROID_HOME}"

WORKDIR /workspace
