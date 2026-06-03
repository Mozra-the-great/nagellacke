package de.nagellacke.di

import android.content.Context
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import de.nagellacke.data.local.CategoryDao
import de.nagellacke.data.local.ManicureDao
import de.nagellacke.data.local.NagellackeDatabase
import de.nagellacke.data.local.PolishDao
import de.nagellacke.data.local.StickerDao
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides @Singleton
    fun provideDatabase(@ApplicationContext ctx: Context): NagellackeDatabase =
        NagellackeDatabase.create(ctx)

    @Provides fun providePolishDao(db: NagellackeDatabase): PolishDao = db.polishDao()
    @Provides fun provideStickerDao(db: NagellackeDatabase): StickerDao = db.stickerDao()
    @Provides fun provideManicureDao(db: NagellackeDatabase): ManicureDao = db.manicureDao()
    @Provides fun provideCategoryDao(db: NagellackeDatabase): CategoryDao = db.categoryDao()
}
